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

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

var workerInfos = {}; // keyed by URL.


function log(msg) {
  Services.console.logStringMessage(new Date().toISOString() + " [frameworker]: " + msg);
};

var _nextPortId = 1;

// This function is magically injected into the sandbox and used there.
// Thus, it is only ever dealing with "worker" ports.
function __initWorkerMessageHandler() {

  let ports = {}; // all "worker" ports currently alive, keyed by ID.

  function messageHandler(event) {
    // We will ignore all messages destined for otherType.
    let data = event.data;
    let portid = data.portId;
    let port;
    if (!data.portFromType || data.portFromType === "worker") {
      // this is a message posted by ourself so ignore it.
      return;
    }
    switch (data.portTopic) {
      case "port-create":
        // a new port was created on the "client" side - create a new worker
        // port and store it in the map
        port = new WorkerPort(portid);
        ports[portid] = port;
        // and call the "onconnect" handler.
        onconnect({ports: [port]});
        break;

      case "port-close":
        // the client side of the port was closed, so close this side too.
        port = ports[portid];
        if (!port) {
          // port already closed (which will happen when we call port.close()
          // below - the client side will send us this message but we've
          // already closed it.)
          return;
        }
        delete ports[portid];
        port.close();
        break;

      case "port-message":
        // the client posted a message to this worker port.
        port = ports[portid];
        if (!port) {
          // port must be closed - this shouldn't happen!
          return;
        }
        port._onmessage(data.data);
        break;

      default:
        break;
    }
  }
  // addEventListener is injected into the sandbox.
  addEventListener('message', messageHandler);
}

// And this is the message listener for the *client* (ie, chrome) side of the world.
function initClientMessageHandler(workerInfo, workerWindow) {
  function _messageHandler(event) {
    // We will ignore all messages destined for otherType.
    let data = event.data;
    let portid = data.portId;
    let port;
    if (!data.portFromType || data.portFromType === "client") {
      // this is a message posted by ourself so ignore it.
      return;
    }
    switch (data.portTopic) {
      // No "port-create" here - client ports are created explicitly.

      case "port-close":
        // the worker side of the port was closed, so close this side too.
        port = workerInfo.ports[portid];
        if (!port) {
          // port already closed (which will happen when we call port.close()
          // below - the worker side will send us this message but we've
          // already closed it.)
          return;
        }
        delete workerInfo.ports[portid];
        port.close();
        break;

      case "port-message":
        // the client posted a message to this worker port.
        port = workerInfo.ports[portid];
        if (!port) {
          return;
        }
        port._onmessage(data.data);
        break;

      default:
        break;
    }
  }
  // this can probably go once debugged and working correctly!
  function messageHandler(event) {
    try {
      _messageHandler(event);
    } catch (ex) {
      Cu.reportError("Error handling client port control message: " + ex + "\n" + ex.stack);
    }
  }
  workerWindow.addEventListener('message', messageHandler);
}


// The port implementation which is shared between clients and workers.
function AbstractPort(portid) {
  this._portid = portid;
  this._handler = undefined;
  // pending messages sent to this port before it has a message handler.
  this._pendingMessagesIncoming = [];
}

AbstractPort.prototype = {
  _portType: null, // set by a subclass.
  // abstract methods to be overridden.
  _dopost: function(data) {
    throw new Error("not implemented");
  },
  _onerror: function(err) {
    throw new Error("not implemented");
  },

  // and concrete methods shared by client and workers.
  toString: function() {
    return "MessagePort(portType='" + this._portType + "', portId=" + this._portid + ")";
  },
  _JSONParse: function(data) JSON.parse(data),

 _postControlMessage: function(topic, data) {
    let postData = {portTopic: topic,
                    portId: this._portid,
                    portFromType: this._portType,
                    data: data};
    this._dopost(postData);
  },

  _onmessage: function(data) {
    // See comments in postMessage below - we work around a cloning
    // issue by using JSON for these messages.
    // Further, we allow the workers to override exactly how the JSON parsing
    // is done - we try and do such parsing in the client window so things
    // like prototype overrides on Array work as expected.
    data = this._JSONParse(data);
    if (!this._handler) {
      this._pendingMessagesIncoming.push(data);
    }
    else {
      try {
        this._handler({data: data});
      }
      catch (ex) {
        this._onerror(ex);
      }
    }
  },

  set onmessage(handler) { // property setter for onmessage
    this._handler = handler;
    while (this._pendingMessagesIncoming.length) {
      this._onmessage(this._pendingMessagesIncoming.shift());
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
    // There seems to be an issue with passing objects directly and letting
    // the structured clone thing work - we sometimes get:
    // [Exception... "The object could not be cloned."  code: "25" nsresult: "0x80530019 (DataCloneError)"]
    // The best guess is that this happens when funky things have been added to the prototypes.
    // It doesn't happen for our "control" messages, only in messages from
    // content - so we explicitly use JSON on these messages as that avoids
    // the problem.
    this._postControlMessage("port-message", JSON.stringify(data));
  },

  close: function() {
    if (!this._portid) {
      return; // already closed.
    }
    this._postControlMessage("port-close");
    // and clean myself up.
    this._handler = null;
    this._pendingMessagesIncoming = [];
    this._portid = null;
  }
}

// Note: this is never instantiated in chrome - the source is sent across
// to the worker and it is evaluated there and created in response to a
// port-create message we send.
function WorkerPort(portid) {
  AbstractPort.call(this, portid);
}

WorkerPort.prototype = {
  __proto__: AbstractPort.prototype,
  _portType: "worker",

  _dopost: function(data) {
    // postMessage is injected into the sandbox.
    postMessage(data, "*");
  },

  _onerror: function(err) {
    // dump() is the only thing available in the worker context to report
    // errors.  We could possibly send a message back to the chrome code so
    // it can be logged more appropriately - later..
    dump("Port " + this + " handler failed: " + err + "\n" + err.stack);
  }
}

// This port lives entirely in chrome.
function ClientPort(portid, clientWindow) {
  this._clientWindow = clientWindow
  this._window = null;
  // messages posted to the worker before the worker has loaded.
  this._pendingMessagesOutgoing = [];
  AbstractPort.call(this, portid);
}

ClientPort.prototype = {
  __proto__: AbstractPort.prototype,
  _portType: "client",

  _JSONParse: function(data) {
    if (this._clientWindow) {
      return this._clientWindow.JSON.parse(data);
    }
    return JSON.parse(data);
  },

  _createWorkerAndEntangle: function(workerInfo) {
    this._window = workerInfo.frame.contentWindow;
    workerInfo.ports[this._portid] = this;
    this._postControlMessage("port-create");
    while (this._pendingMessagesOutgoing.length) {
      this._dopost(this._pendingMessagesOutgoing.shift());
    }
  },

  _dopost: function(data) {
    if (!this._window) {
      this._pendingMessagesOutgoing.push(data);
    } else {
      this._window.postMessage(data, "*");
    }
  },

  _onerror: function(err) {
    Cu.reportError("Port " + this + " handler failed: " + err + "\n" + err.stack);
  },

  close: function() {
    if (!this._portid) {
      return; // already closed.
    }
    // a leaky abstraction due to the worker spec not specifying how the
    // other end of a port knows it is closing.
    this.postMessage({topic: "social.port-closing"});
    AbstractPort.prototype.close.call(this);
    this._window = null;
    this._pendingMessagesOutgoing = null;
  }
}

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
function FrameWorker(url, clientWindow, name) {
  let workerName = (name ? name : url);
  log("creating worker for " + workerName);
  // first create the client port we are going to use.  Laster we will
  // message the worker to create the worker port.
  let portid = _nextPortId++;
  let clientPort = new ClientPort(portid, clientWindow);

  let workerInfo = workerInfos[url];
  if (!workerInfo) {
    log("creating a new worker for " + workerName);
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
      pendingPorts: [clientPort], // ports yet to be connected.
      ports: {}, // all live, connected ports
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
          try {
            if (workerWindow[fn]) {
              sandbox[fn] = workerWindow[fn];
            }
          }
          catch(e) {
            Cu.reportError("failed to import API "+fn+"\n"+e+"\n");
          }
        }
        Object.defineProperty(sandbox, 'cookie', {
          get: function() { return workerWindow.document.cookie },
          set: function(val) { workerWindow.document.cookie = val },
          enumerable: true
        });
        sandbox.importScripts = function importScripts() {
          if (arguments.length < 1) return;
          let workerURI = Services.io.newURI(url, null, null);
          for each(let uri in arguments) {
            // resolve the uri against the loaded worker
            let scriptURL = workerURI.resolve(uri);
            if (scriptURL.indexOf(workerURI.prePath) != 0) {
              throw new Error("importScripts same-origin violation with "+uri);
            }
            log("importScripts loading "+scriptURL);
            // load the url *synchronously*
            let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
                        .createInstance(Ci.nsIXMLHttpRequest);
            xhr.open('GET', scriptURL, false);
            xhr.onreadystatechange = function(aEvt) {
              if (xhr.readyState == 4) {
                if (xhr.status == 200 || xhr.status == 0) {
                  try {
                    Cu.evalInSandbox(xhr.responseText, sandbox);
                  }
                  catch(e) {
                    Cu.reportError("importScripts eval failed: "+e);
                  }
                }
                else {
                  Cu.reportError("Unable to importScripts ["+scriptURL+"], status " + xhr.status);
                }
              }
            };
            xhr.send(null);
          }
        };
        // and we delegate ononline and onoffline events to the worker.
        // See http://www.whatwg.org/specs/web-apps/current-work/multipage/workers.html#workerglobalscope
        frame.addEventListener('offline', function(event) {
          Cu.evalInSandbox("onoffline();", sandbox);
        }, false);
        frame.addEventListener('online', function(event) {
          Cu.evalInSandbox("ononline();", sandbox);
        }, false);

        sandbox.postMessage = function(d, o) { workerWindow.postMessage(d, o) };
        sandbox.addEventListener = function(t, l, c) { workerWindow.addEventListener(t, l, c) };

        // And a very hacky work-around for bug 734215
        sandbox.bufferToArrayHack = function(a) {
            return new workerWindow.Uint8Array(a);
        };

        workerWindow.addEventListener("load", function() {
          log("got worker onload event for " + workerName);
          // the iframe has loaded the js file as text - first inject the magic
          // port-handling code into the sandbox.
          function getProtoSource(ob) {
            let raw = ob.prototype.toSource();
            return ob.name + ".prototype=" + raw + ";"
          }
          try {
            let scriptText = [AbstractPort.toSource(),
                              getProtoSource(AbstractPort),
                              WorkerPort.toSource(),
                              getProtoSource(WorkerPort),
                              // *sigh* - toSource() doesn't do __proto__
                              "WorkerPort.prototype.__proto__=AbstractPort.prototype;",
                              __initWorkerMessageHandler.toSource(),
                              "__initWorkerMessageHandler();" // and bootstrap it.
                             ].join("\n")
            Cu.evalInSandbox(scriptText, sandbox, "1.8", "<injected port handling code>", 1);
          }
          catch (e) {
            Cu.reportError("Error injecting port code into content side of the worker: " + e + "\n" + e.stack);
          }
          // and wire up the client message handling.
          try {
            initClientMessageHandler(workerInfo, workerWindow);
          }
          catch (e) {
            Cu.reportError("Error setting up event listener for chrome side of the worker: " + e + "\n" + e.stack);
          }
          // Now get the worker js code and eval it into the sandbox
          try {
            let scriptText = workerWindow.document.body.textContent;
            Cu.evalInSandbox(scriptText, sandbox, "1.8", workerWindow.location.href, 1);
          } catch (e) {
            Cu.reportError("Error evaluating worker script for " + workerName + ": " + e + "; " +
                (e.lineNumber ? ("Line #" + e.lineNumber) : "") +
                (e.stack ? ("\n" + e.stack) : ""));
            return;
          }
          // so finally we are ready to roll - dequeue all the pending connects
          workerInfo.loaded = true;
          // save the sandbox somewhere convenient before we connect.
          frame.sandbox = sandbox;
          let pending = workerInfo.pendingPorts;
          log("worker window " + workerName + " loaded - connecting " + pending.length + " ports");
          while (pending.length) {
            let port = pending.shift();
            if (port._portid) { // may have already been closed!
              try {
                port._createWorkerAndEntangle(workerInfo);
              }
              catch(e) {
                Cu.reportError("Failed to create worker port: " + e + "\n" + e.stack);
              }
            }
          }

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
      try {
        clientPort._createWorkerAndEntangle(workerInfo);
      }
      catch (ex) {
        Cu.reportError("Failed to connect a port: " + e + "\n" + e.stack);
      }
    }
    else {
      workerInfo.pendingPorts.push(clientPort);
    }
  }

  // return the pseudo worker object.
  // XXX - workers have no .close() method, but *do* have a .terminate()
  // method which we should implement. However, the worker spec doesn't define
  // a callback to be made in the worker when this happens - it all just dies.
  // TODO: work out a sane impl for 'terminate'.
  function terminate() {
    log("worker at " + workerName + " terminating");
    // closing the port also removes it from workerInfo.ports, so we don't
    // iterate over that directly, just over the port IDs.
    for each (let portid in Object.keys(workerInfo.ports)) {
      try {
        workerInfo.ports[portid].close();
      }
      catch (ex) {
        Cu.reportError(ex);
      }
    }
    // and do the actual killing on a timeout so the pending events get
    // delivered first.
    workerInfo.frame.contentWindow.setTimeout(function() {
      // now nuke the iframe itself and forget everything about this worker.
      let appShell = Cc["@mozilla.org/appshell/appShellService;1"]
                      .getService(Ci.nsIAppShellService);
      let hiddenDOMWindow = appShell.hiddenDOMWindow;
      let doc = hiddenDOMWindow.document;
      let container = doc.body ? doc.body : doc.documentElement;
      container.removeChild(workerInfo.frame);
      delete workerInfos[url];
      log("worker terminated!");
    }, 0);
  }
  return {port: clientPort, terminate: terminate};
};

const EXPORTED_SYMBOLS = ["FrameWorker"];
