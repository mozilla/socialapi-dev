/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *  Edward Lee <edilee@mozilla.com>
 *  Mark Hammond <mhammond@mozilla.com>
 *  Shane Caraveo <scaraveo@mozilla.com>
 */

/*
* This is an implementation of a "Shared Worker" using an iframe in the
* hidden DOM window.  A subset of new APIs are introduced to the window
* by cloning methods from the worker's JS origin.
*/

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");

var notification = {};
Cu.import("resource://socialdev/modules/notification.js", notification);

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

var workerInfos = {}; // keyed by URL.

function log(msg) {
  Services.console.logStringMessage(new Date().toISOString() + " [frameworker]: " + msg);
};

var _nextPortId = 1;
var _numPortsAlive = 0;


/**
 * MessagePort
 *
 * An entagled message port is used for each connection from a content panel
 * into a frameworker.
 */
function MessagePort(name) {
  this._name = name + "(" + _nextPortId++ + ")";
  this._entangled = null; // null, or another MessagePort object
  this._onmessage = undefined; // set when the owner sets worker.onmessage.
  this._pendingMessages = []; // pending messages before the other side has attached.
  this._worker = null; // null, or for the port in the worker, the worker global.
  _numPortsAlive++;
};

MessagePort.prototype = {
  __exposedProps__: {postMessage: "r", onmessage: "rw", close: "r", toString: "r"},
  set onmessage(handler) { // property setter for onmessage
    this._onmessage = function(ev) {
      //log(this._name+ " onmessage "+ev.data.topic);
      let newEv = JSON.parse(JSON.stringify(ev));
      try {
        handler(newEv);
      }
      catch(e) {
        Cu.reportError("Port handler failed: " + e);
      }
    }
    while (this._pendingMessages.length) {
      handler(JSON.parse(JSON.stringify(this._pendingMessages.shift())));
    }
  },

  /**
   * postMessage
   *
   * Send data to the onmessage handler on the other end of the port.  The
   * data object should have a topic property.
   *
   * @param {jsobj} data
   */
  postMessage: function(data) {
    //log(this._name+ " postMessage "+data.topic);
    // dump("postMessage " + data + "\n");
    let eventToPost = {data: data};
    let entangled = this._entangled;
    if (!entangled) {
      throw new Error("port closed or not started");
    }
    if (entangled._onmessage) {
        entangled._onmessage(eventToPost);
    }
    else {
      entangled._pendingMessages.push(eventToPost);
    }
  },

  /**
   * close
   *
   * closes both ends of an entangled port
   */
  close: function() {
    if (!this._entangled) {
      return; // already closed.
    }
    // XXX - note that the W3C spec for workers doesn't define an ondisconnect
    // method, but we need one so the worker removes the broadcast ports.
    if (this._worker) {
      this._worker.ondisconnect({ports: [this]});
      this._worker = null;
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




/**
 * FrameWorker
 *
 * A Frameworker is an iframe that is attached to the hiddenWindow,
 * which contains a pair of MessagePorts.  It is constructed with the
 * URL of some JavaScript that will be run in the context of the window;
 * the script does not have a full DOM but is instead run in a sandbox
 * that has a select set of methods cloned from the URL's domain.
 * 
 * The FrameWorker iframe is a singleton for a given script URL.  If one
 * alread, exists, the FrameWorker constructor will connect to it.
 *
 * @param {String} url
 * @returns {Object} object containing a port and terminate function
 */
function FrameWorker(url, service) {
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
    }
    catch (ex) {
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

        let sandbox = new Cu.Sandbox(workerWindow);
        // copy the window apis onto the sandbox namespace only functions or
        // objects that are naturally a part of an iframe, I'm assuming they are
        // safe to import this way
        let workerAPI = ['MozWebSocket', 'WebSocket', 'mozIndexedDB', 'localStorage',
                         'XMLHttpRequest',
                         'atob', 'btoa', 'clearInterval', 'clearTimeout', 'dump',
                         'setInterval', 'setTimeout',
                         'MozBlobBuilder', 'FileReader', 'Blob',
                         'navigator'];
        for each(let fn in workerAPI) {
          if (workerWindow[fn]) {
            sandbox.importFunction(workerWindow[fn], fn);
          }
        }

        // chrome functions we want to have accessible to the sandbox
        sandbox.importFunction(notification.Notification, "Notification");
        sandbox.importFunction(notification.createAmbientNotification(service), "AmbientNotification");
        sandbox.importFunction(function importScripts(uris) {
          if (uris instanceof Array) {
            for each(let uri in uris) {
              Services.scriptloader.loadSubScript(uri, sandbox);
            }
          }
          else
            Services.scriptloader.loadSubScript(uris, sandbox);
        }, 'importScripts');
        // and we delegate ononline and onoffline events to the worker.
        // See http://www.whatwg.org/specs/web-apps/current-work/multipage/workers.html#workerglobalscope
        frame.addEventListener('offline', function(event) {
          Cu.evalInSandbox("onoffline();", sandbox);
        }, false);
        frame.addEventListener('online', function(event) {
          Cu.evalInSandbox("ononline();", sandbox);
        }, false);

        workerWindow.addEventListener("load", function() {
          log("got worker onload event");
          // after the iframe has loaded the js file as text, get the text and
          // eval it into the sandbox

          try {
            try {
              let scriptText = workerWindow.document.body.textContent;
              Cu.evalInSandbox(scriptText, sandbox, "1.8", workerWindow.location.href, 1);  
            } catch (e) {
              log("Error while evaluating worker script for " + url + ": " + e, e.stack);
              log(e.stack);
              return;
            }

            // so finally we are ready to roll - dequeue all the pending connects
            workerInfo.loaded = true;
            let pending = workerInfo.pendingWorkers;
            log("worker window " + url + " loaded - connecting " + pending.length + " workers");
            log("worker window is " + workerWindow);
            while (pending.length) {
              let port = pending.shift();
              port._worker = sandbox;
              sandbox.onconnect({ports: [port]});
            }
          }
          catch(e) {
            Cu.reportError("Failed to dequeue pending worker events", e, "\n", e.stack);
          }
          // save the sandbox somewhere convenient
          frame.sandbox = sandbox;
        }, true);
      }
      catch(e) {
        Cu.reportError("frameworker unable to inject for "+doc.location + " ("+ e + ")");
      }
    };
    Services.obs.addObserver(injectController, 'document-element-inserted', false);
    let doc = hiddenDOMWindow.document;
    let container = doc.body ? doc.body : doc.documentElement;
    container.appendChild(frame);

  }
  else {
    // already have a worker - either queue or make the connection.
    if (workerInfo.loaded) {
      workerPort._worker = workerInfo.frame.sandbox;
      workerInfo.frame.sandbox.onconnect({ports: [workerPort]});
    }
    else {
      workerInfo.pendingWorkers.push(workerPort);
    }
  }

  // return the pseudo worker object.
  // XXX - workers have no .close() method, but *do* have a .terminate()
  // method which we should implement. However, the worker spec doesn't define
  // a callback to be made in the worker when this happens - it all just dies.
  // TODO: work out a sane impl for 'terminate'.
  function terminate() {
    log("worker at " + url + " terminating");
    workerInfo.frame.sandbox.onterminate();
    // now nuke the iframe itself and forget everything about this worker.
    let appShell = Cc["@mozilla.org/appshell/appShellService;1"]
                    .getService(Ci.nsIAppShellService);
    let hiddenDOMWindow = appShell.hiddenDOMWindow;
        let doc = hiddenDOMWindow.document;
    let container = doc.body ? doc.body : doc.documentElement;
    container.removeChild(workerInfo.frame);
    workerInfos[url] = null;
    log("worker terminated!");
  }
  return {port: clientPort, terminate: terminate};
};

const EXPORTED_SYMBOLS = ["FrameWorker"];
