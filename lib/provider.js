/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
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

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://socialdev/lib/console.js");
let frameworker = {};
Cu.import("resource://socialdev/lib/frameworker.js", frameworker);
Cu.import("resource://gre/modules/NetUtil.jsm", this);

const EXPORTED_SYMBOLS = ["SocialProvider"];

function SocialProvider(input) {
  this.name = input.name;
  this.workerURL = input.workerURL;
  this.sidebarURL = input.sidebarURL;
  this.URLPrefix = input.URLPrefix;
  this.iconURL = input.inputURL;
  this.contentPatch = input.contentPatch;
  this.contentPatchPath = input.contentPatchPath;
  return this;
}

SocialProvider.prototype = {

  _log: function(msg) {
    console.log(new Date().toISOString() + " [" + this.name + " service]: " + msg);
  },

  init: function(windowCreatorFn, callback) {
    this._log("init");
    this.windowCreatorFn = windowCreatorFn;
    // Should we create the Worker right away?  Probably.
  
    let self = this;
  
    if (this.contentPatchPath) {
      this._log("Starting async load of " + this.contentPatchPath);
      
      // XXX we probably just want to rip our contentPatching,
      // but for now we put in a sanity check.
      if (this.contentPatchPath.indexOf("resource:") != 0) {
        this._log("Content patching is only allowed from resource: URLs");
        return;
      }
      let channel = NetUtil.newChannel(this.contentPatchPath);
      NetUtil.asyncFetch(channel, function(aInputStream, aResult) {
      
        try {
          if (!Components.isSuccessCode(aResult)) {
            // Handle error
            self._log("Error while loading content patch");
            return;
          }
    
          // Consume the input stream.
          // XXXX blocking I/O, what's the right way to do this???
          var buf = [];
          do {
            /// XXX how to handle looping for slow I/O?  it's always
            // coming from disk, maybe we're okay.
            var avail = aInputStream.available();
            console.log("requesting " + avail + " bytes");
            var part = NetUtil.readInputStreamToString(aInputStream, avail);
            buf += part;
            break;
          } while (true);
    
          self.contentPatch = buf;
          self._log("calling provider init callback after reading " + self.contentPatch.length + " bytes");
          callback();
        }
        catch (e) {
          console.log("Error while loading content patch: " + e);
          console.log(e.stack);
        }
      });
    }
    else {
      this._log("calling init callback");
      callback();
    }
  },
  shutdown: function() {
    try {
      this._log("shutdown");
      var worker = this.makeWorker(null);
      worker.port.close(); // shouldn't be necessary...
      worker.terminate();
    }
    catch (e) {
      this._log(e);
    }
  },
  makeWorker: function(window) {
    // XXX - todo - check the window origin to match the service prefix
    if (this.workerURL) {
      return frameworker.FrameWorker(this.workerURL);
    }
    else {
      this._log("makeWorker cannot create worker: no workerURL specified");
      throw new Exception("makeWorker cannot create worker: no workerURL specified");
    }
  },
  attachToWindow: function(targetWindow, windowOpenerFn) {
    let self = this;
    this._log("attachToWindow");
    var worker = this.makeWorker(targetWindow.wrappedJSObject);
  
    worker.port.onmessage = function(e) {
      self._log("worker message: " + JSON.stringify(e));
    };
  
    var self = this;
    targetWindow.wrappedJSObject.navigator.mozSocial = {
      // XXX - why a function?  May mis-lead people into
      // thinking it is creating a *new* worker which
      // can/should have its port closed (which this one
      // should not) AND may cause people to think a new
      // onmessage handler can be added (which would screw us)
      getWorker: function() {
        return worker;
      },
      openServiceWindow: function(toURL, name, options, title, readyCallback) {
        return windowOpenerFn(toURL, name, options, self, title, readyCallback);
      },
      hasBeenIdleFor: function(ms) {
        const idleService = Cc["@mozilla.org/widget/idleservice;1"].getService(Ci.nsIIdleService);
        return idleService.idleTime >= ms;
      }
    }
  
    targetWindow.external = {};
    if (this.contentPatch) {
      this._log("Applying content patch");
      let sandbox = new Cu.Sandbox(targetWindow, {
          sandboxPrototype: targetWindow,
          wantXrays: false
      });
      try {
        Cu.evalInSandbox(this.contentPatch, sandbox, "1.8");
        this._log("Successfully applied content patch");
      }
      catch (e) {
        this._log("Error while applying content patch: " + e);
      }
    }
    else {
      this._log("No content patch");
    }
  
    targetWindow.addEventListener("unload", function() {
      try {
        worker.port.close();
      }
      catch(e) {
        this._log("Exception while closing worker: " + e);
      }
    }, false);
  
  },
  windowClosing: function(aWindow) {
    // assume for now that we only allow one window per service
    if (aWindow == this.serviceWindow) {
      this.serviceWindow = null;
    }
  }

}
