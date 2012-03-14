/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is socialdev.
 *
 * The Initial Developer of the Original Code is The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2012
 * the Initial Developer. All Rights Reserved.
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
* This is an implementation of a "Shared Worker" using an iframe in the
* hidden DOM window.  A subset of new APIs are introduced to the window
* by cloning methods from the worker's JS origin.
*/

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/lib/console.js");

var notification = {};
Cu.import("resource://socialdev/lib/notification.js", notification);

const scriptLoader = Cc['@mozilla.org/moz/jssubscript-loader;1'].
                     getService(Ci.mozIJSSubScriptLoader);

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

var workerInfos = {}; // keyed by URL.

function log(msg) {
  console.log(new Date().toISOString(), "[frameworker]:", msg);
};

var _nextPortId = 1;
var _numPortsAlive = 0;

function MessagePort(name) {
  this._name = name + "(" + _nextPortId++ + ")";
  this._entangled = null; // null, or another MessagePort object
  this._onmessage = undefined; // set when the owner sets worker.onmessage.
  this._pendingMessages = []; // pending messages before the other side has attached.
  this._workerWindow = null; // null, or for the port in the worker, the window.
  _numPortsAlive++;
};

MessagePort.prototype = {
  set onmessage(handler) { // property setter for onmessage
    this._onmessage = function(ev) {
      //console.log(this._name+ " onmessage "+ev.data.topic);
      let newEv = JSON.parse(JSON.stringify(ev));
      try {
        handler(newEv);
      } catch(e) {
        console.log(e);
      }
    }
    while (this._pendingMessages.length) {
      handler(JSON.parse(JSON.stringify(this._pendingMessages.shift())));
    }
  },

  postMessage: function(data) {
    //console.log(this._name+ " postMessage "+data.topic);
    // dump("postMessage " + data + "\n");
    let eventToPost = {data: data};
    let entangled = this._entangled;
    if (!entangled) {
      throw new Error("port closed or not started");
    }
    if (entangled._onmessage) {
        entangled._onmessage(eventToPost);
    } else {
      entangled._pendingMessages.push(eventToPost);
    }
  },

  close: function() {
    if (!this._entangled) {
      return; // already closed.
    }
    // XXX - note that the W3C spec for workers doesn't define an ondisconnect
    // method, but we need one so the worker removes the broadcast ports.
    if (this._workerWindow) {
      this._workerWindow.ondisconnect({ports: [this]});
      this._workerWindow = null;
    }

    // not sure this is 100% correct, but also close the other side.
    let other = this._entangled;
    this._entangled = null; // must reset early to avoid recursion death.
    other.close();
    this._onmessage = null;
    this._pendingMessages = null;
    _numPortsAlive--;
    log("closed port " + this._name + " - now " + _numPortsAlive + " ports alive");
  },

  _entangle: function(that) {
    // XXX - check this and that aren't already entangled etc.
    this._entangled = that;
    that._entangled = this;
  },

  toString: function() {
    return "MessagePort('" + this._name + "')";
  }
};



// A Frameworker is an iframe that is attached to the hiddenWindow,
// which contains a pair of MessagePorts.  It is constructed with the
// URL of some JavaScript that will be run in the context of the window;
// the script does not have a full DOM but is instead run in a sandbox
// that has a select set of methods cloned from the URL's domain.
//
// The FrameWorker iframe is a singleton for a given script URL.  If one
// alread, exists, the FrameWorker constructor will connect to it.
//

function FrameWorker(url) {
  log("creating worker for " + url);
  // first create the ports we are going to use and entangle them.
  let clientPort = new MessagePort('client');
  let workerPort = new MessagePort('worker');
  clientPort._entangle(workerPort);

  let workerInfo = workerInfos[url];
  if (!workerInfo) {
    log("creating a new worker for " + url);
    let appShell = Cc["@mozilla.org/appshell/appShellService;1"]
                    .getService(Ci.nsIAppShellService);
    let hiddenDOMWindow = appShell.hiddenDOMWindow;
    // hrmph - I guess mixedpuppy had a good reason for changing from
    // createElement to createElementNS, but markh gets NS_ERROR_NOT_AVAILABLE
    // so just try both :)
    let frame;
    try {
      frame = hiddenDOMWindow.document.createElementNS(XUL_NS, "iframe");
    } catch (ex) {
      frame = hiddenDOMWindow.document.createElement("iframe");
    }
    frame.setAttribute("type", "content");
    frame.setAttribute("src", url);

    // setup the workerInfo and add this connection to the pending queue
    workerInfo = workerInfos[url] = {
      frame: frame,
      pendingWorkers: [workerPort],
      loaded: false
    };

    var injectController = function(doc, topic, data) {
      try {
        if (!doc.defaultView || doc.defaultView != frame.contentWindow) {
          return;
        }
        Services.obs.removeObserver(injectController, 'document-element-inserted', false);

        let workerWindow = frame.contentWindow;

        let sandbox = new Cu.Sandbox(workerWindow, {
          sandboxPrototype: workerWindow,
          wantXrays: true
        });
        Object.defineProperties(sandbox, {
          // We need "this === window === top" to be true in toplevel scope:
          window: { get: function() sandbox },
          top: { get: function() sandbox },
        });

        // copy the window apis onto the sandbox namespace only functions or
        // objects that are naturally a part of an iframe, I'm assuming they are
        // safe to import this way
        let workerAPI = ['MozWebSocket', 'WebSocket', 'mozIndexedDB', 'localStorage',
                         'XMLHttpRequest',
                         'atob', 'btoa', 'clearInterval', 'clearTimeout', 'dump',
                         'setInterval', 'setTimeout'];
        for each(let fn in workerAPI) {
          sandbox[fn] = workerWindow[fn];
        }

        // chrome functions we want to have accessible to the sandbox
        sandbox.importFunction(notification.Notification, "Notification");
        sandbox.importFunction(function importScripts(uri) {
          scriptLoader.loadSubScript(uri, sandbox);
        }, 'importScripts');
        sandbox.importFunction(console, "console");
        // and we delegate ononline and onoffline events to the worker.
        // See http://www.whatwg.org/specs/web-apps/current-work/multipage/workers.html#workerglobalscope
        frame.contentWindow.onoffline = function() {
          if (sandbox.onoffline) sandbox.onoffline();
        };
        frame.contentWindow.ononline = function() {
          if (sandbox.ononline) sandbox.ononline();
        };

        workerWindow.addEventListener("load", function() {
          log("got worker onload event");
          // after the iframe has loaded the js file as text, get the text and
          // eval it into the sandbox
          let scriptText = workerWindow.document.body.textContent;
          Cu.evalInSandbox(scriptText, sandbox, "1.8", workerWindow.location.href, 1);

          try {
            // so finally we are ready to roll - dequeue all the pending connects
            workerInfo.loaded = true;
            let pending = workerInfo.pendingWorkers;
            log("worker window " + url + " loaded - connecting " + pending.length + " workers");
            let ww = sandbox.window;
            while (pending.length) {
              let port = pending.shift();
              port._workerWindow = ww;
              sandbox.window.onconnect({ports: [port]});
            }
          } catch(e) {
            console.log("Failed to dequeue pending worker events", e, "\n", e.stack);
          }
          // save the sandbox somewhere convenient
          frame.sandbox = sandbox;
        }, true);
      } catch(e) {
        console.log("unable to inject for "+doc.location);
        console.log(e);
      }
    };
    Services.obs.addObserver(injectController, 'document-element-inserted', false);
    let doc = hiddenDOMWindow.document;
    let container = doc.body ? doc.body : doc.documentElement;
    container.appendChild(frame);

  } else {
    // already have a worker - either queue or make the connection.
    if (workerInfo.loaded) {
      let workerWindow = workerInfo.frame.sandbox.window;
      workerPort._workerWindow = workerWindow;
      workerWindow.onconnect({ports: [workerPort]});
    } else {
      workerInfo.pendingWorkers.push(workerPort);
    }
  }

  // return the pseudo worker object.
  // XXX - workers have no .close() method, but *do* have a .terminate()
  // method which we should implement. However, the worker spec doesn't define
  // a callback to be made in the worker when this happens - it all just dies.
  // TODO: work out a sane impl for 'terminate'.
  function terminate() {
    console.log("worker terminate method called - implement me!");
  }
  return {port: clientPort, terminate: terminate};
};

const EXPORTED_SYMBOLS = ["FrameWorker"];
