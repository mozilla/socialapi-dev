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

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
let frameworker = {};
Cu.import("resource://socialdev/modules/frameworker.js", frameworker);
Cu.import("resource://socialdev/modules/servicewindow.js");

const EXPORTED_SYMBOLS = ["SocialProvider"];


function SocialProvider(input) {
  this._log("creating social provider for "+input.origin);
  this.name = input.name;
  this.workerURL = input.workerURL;
  this.sidebarURL = input.sidebarURL;
  this.URLPrefix = input.URLPrefix;
  this.iconURL = input.iconURL;
  this.origin = input.origin;
  this.enabled = input.enabled;  // disabled services cannot be used
  this._active = input.enabled;   // active when we have a frameworker running
  // we only patch content for builtins
  if (input.contentPatchPath && input.contentPatchPath.indexOf('resource:')==0)
    this.contentPatchPath = input.contentPatchPath;
  this.init();

  return this;
}

SocialProvider.prototype = {

  _log: function(msg) {
    Services.console.logStringMessage(new Date().toISOString() + " [" + this.origin + " service]: " + msg);
  },

  init: function(windowCreatorFn) {
    if (!this.enabled) return;
    this._log("init");
    this.windowCreatorFn = windowCreatorFn;
    Services.obs.notifyObservers(null, "social-service-init-ready", this.origin);
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
    this._active = false;
    Services.obs.notifyObservers(null, "social-service-shutdown", this.origin);
  },
  activate: function() {
    if (this.enabled) {
      this.init();
      this._active = true;
      Services.obs.notifyObservers(null, "social-service-activated", this.origin);
    }
  },
  deactivate: function() {
    if (!this._active) return;
    closeWindowsForService(this);
    this._active = false;
    Services.obs.notifyObservers(null, "social-service-deactivated", this.origin);
    // XXX is deactivate the same as shutdown?
    this.shutdown();
  },
  makeWorker: function(window) {
    // XXX - todo - check the window origin to match the service prefix
    if (!this.enabled) {
      throw new Error("cannot use disabled service "+this.origin);
    }
    if (this.workerURL) {
      return frameworker.FrameWorker(this.workerURL);
    }
    else {
      this._log("makeWorker cannot create worker: no workerURL specified");
      throw new Error("makeWorker cannot create worker: no workerURL specified for "+this.origin);
    }
  },
  attachToWindow: function(targetWindow) {
    if (!this.enabled) {
      throw new Error("cannot use disabled service "+this.origin);
    }
    let self = this;
    this._log("attachToWindow");
    var worker = this.makeWorker(targetWindow.wrappedJSObject);
  
    worker.port.onmessage = function(e) {
      self._log("worker message: " + JSON.stringify(e));
    };

    let sandbox = new Cu.Sandbox(targetWindow, {
      sandboxPrototype: targetWindow,
      wantXrays: false
    });

    // navigator is part of the sandbox proto. We're not using
    // nsIDOMGlobalPropertyInitializer here since we're selectivly injecting
    // this only into social panels.
    Object.defineProperty(sandbox.navigator, "mozSocial", {
      value: {
        // XXX - why a function?  May mis-lead people into
        // thinking it is creating a *new* worker which
        // can/should have its port closed (which this one
        // should not) AND may cause people to think a new
        // onmessage handler can be added (which would screw us)
        getWorker: function() {
          return worker;
        },
        openServiceWindow: function(toURL, name, options, title, readyCallback) {
          return createServiceWindow(toURL, name, options, self, title, readyCallback);
        },
        hasBeenIdleFor: function(ms) {
          const idleService = Cc["@mozilla.org/widget/idleservice;1"].getService(Ci.nsIIdleService);
          return idleService.idleTime >= ms;
        }
      }
    });

    if (this.contentPatchPath) {
      try {
        // this only happens if contentPatch is local, we'll keep it simple
        // and just use the scriptLoader
        Services.scriptloader.loadSubScript(this.contentPatchPath, sandbox);
        this._log("Successfully applied content patch");
      }
      catch (e) {
        this._log("Error while applying content patch: " + e);
      }
    }
  
    targetWindow.addEventListener("unload", function() {
      try {
        worker.port.close();
      }
      catch(e) {
        self._log("Exception while closing worker: " + e);
      }
    }, false);
  
  }

}
