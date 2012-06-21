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
Cu.import("resource://socialapi/modules/Frameworker.jsm", frameworker);
Cu.import("resource://socialapi/modules/servicewindow.js");
Cu.import("resource://socialapi/modules/workerapi.js");

const EXPORTED_SYMBOLS = ["SocialProvider"];

/**
 * SocialProvider
 *
 * The socialProvider manages shutdown of our shared frameworker, and handles
 * injecting same-origin content with additional APIs used to interact
 * with the frameworker and other social content spaces in the browser.  There
 * is one instance of this class per installed social provider.
 *
 * @constructor
 * @param {jsobj} portion of the manifest file describing this provider
 *
 * The 'active' provider is the currently selected provider in the UI.
 */
function SocialProvider(input) {
  this.name = input.name;
  this.workerURL = input.workerURL;
  this.sidebarURL = input.sidebarURL;
  this.iconURL = input.iconURL;
  this.origin = input.origin;
  this.enabled = input.enabled;  // disabled services cannot be used
  this._active = false; // must call .activate() to be active.
  this._workerapi = null;
  // we only patch content for builtins
  if (input.contentPatchPath && input.contentPatchPath.indexOf('resource:')==0)
    this.contentPatchPath = input.contentPatchPath;
  this._log("creating social provider for "+input.origin);
  this.init();

  return this;
}

SocialProvider.prototype = {

  _log: function(msg) {
    Services.console.logStringMessage(new Date().toISOString() + " [" + this.origin + " service]: " + msg);
  },

  get notificationsPermitted() {
    try {
      var prefs = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
      var val = prefs.getBoolPref("allow-notifications." + this.origin);
      if (val) return val;
      return false;
    }
    catch(e) {
      return false;
    }
  },

  set notificationsPermitted(permitted) {
    try {
      var prefs = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
      var val = prefs.setBoolPref("allow-notifications." + this.origin, permitted);
    }
    catch(e) {
      Cu.reportError(e);
    }
  },

  init: function(windowCreatorFn) {
    if (!this.enabled) return;
    this._log("init");
    this.windowCreatorFn = windowCreatorFn;
  },

  /**
   * shutdown
   *
   * called by the ProviderRegistry when the provider should shutdown the
   * frameworker.
   */
  shutdown: function() {
    closeWindowsForService(this);
    if (this._workerapi) {
      this._workerapi.shutdown();
      this._workerapi = null;
    }
    try {
      this._log("shutdown");
      this.makeWorker(null).terminate();
    }
    catch (e) {
      this._log(e);
    }
    this._active = false;
  },

  /**
   * called by the ProviderRegistry to ensure the provider is initialized
   * and ready.
   */
  activate: function() {
    if (this.enabled) {
      this.init();
      this._workerapi = new workerAPI(this.makeWorker(), this);
      this._active = true;
    }
  },

  /**
   * makeWorker
   *
   * creates a new message port connected to a shared frameworker
   *
   * @param {DOMWindow} window
   */
  makeWorker: function(window) {
    // XXX - todo - check the window origin to match the service prefix
    if (!this.workerURL) {
      Services.console.logStringMessage("no workerURL for provider "+this.origin);
      return null;
    }
    if (!this.enabled) {
      throw new Error("cannot use disabled service "+this.origin);
    }
    if (!this.workerURL) {
      this._log("makeWorker cannot create worker: no workerURL specified");
      throw new Error("makeWorker cannot create worker: no workerURL specified for "+this.origin);
    }
    return frameworker.FrameWorker(this.workerURL, window);
  },

  /**
   * attachToWindow
   *
   * loads sandboxed support functions and socialAPI into content panels for
   * this provider.
   *
   * @param {DOMWindow}
   */
  attachToWindow: function(targetWindow) {
    if (!this.enabled) {
      throw new Error("cannot use disabled service "+this.origin);
    }
    let self = this;
    this._log("attachToWindow");
    var worker = this.makeWorker(targetWindow.wrappedJSObject);
    if (worker) {
      worker.port.onmessage = function(e) {
        self._log("worker message: " + JSON.stringify(e));
      };
    }

    let sandbox = new Cu.Sandbox(targetWindow, {
      sandboxPrototype: targetWindow,
      wantXrays: false
    });

    // navigator is part of the sandbox proto. We're not using
    // nsIDOMGlobalPropertyInitializer here since we're selectivly injecting
    // this only into social panels.
    Object.defineProperty(sandbox.window.navigator, "mozSocial", {
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
        },
        getAttention: function() {
          // oh yeah, this is obvious, right?
          // See https://developer.mozilla.org/en/Working_with_windows_in_chrome_code
          let mainWindow = targetWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                             .getInterface(Components.interfaces.nsIWebNavigation)
                             .QueryInterface(Components.interfaces.nsIDocShellTreeItem)
                             .rootTreeItem
                             .QueryInterface(Components.interfaces.nsIInterfaceRequestor)
                             .getInterface(Components.interfaces.nsIDOMWindow);
          mainWindow.getAttention();
        },
        __exposedProps__: {
          getWorker: 'r',
          openServiceWindow: 'r',
          hasBeenIdleFor: 'r',
          getAttention: 'r'
        }
      }
    });

    if (this.contentPatchPath) {
      try {
        // this only happens if contentPatch is local, we'll keep it simple
        // and just use the scriptLoader
        Services.scriptloader.loadSubScript(this.contentPatchPath, targetWindow);
        this._log("Successfully applied content patch");
      }
      catch (e) {
        this._log("Error while applying content patch: " + e);
      }
    }

    targetWindow.addEventListener("unload", function() {
      // We want to close the port, but also want the target window to be
      // able to use the port during an unload event they setup - so we
      // set a timer which will fire after the unload events have all fired.
      let event = {
        notify: function(timer) {
          worker.port.close();
        }
      }
      let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(event, 0, Ci.nsITimer.TYPE_ONE_SHOT);
    }, false);

  },

  setAmbientNotificationBackground: function(background) {
    this.ambientNotificationBackground = background;
    Services.obs.notifyObservers(null, "social-browsing-ambient-notification-changed", null);//XX which args?
  },

  createAmbientNotificationIcon: function(name) {
    // if we already have one named, return that
    if (!this.ambientNotificationIcons) this.ambientNotificationIcons = {};
    if (this.ambientNotificationIcons[name]) {
      return this.ambientNotificationIcons[name];
    }
    var icon = {
      setBackground: function(backgroundText) {
        icon.background = backgroundText;
        Services.obs.notifyObservers(null, "social-browsing-ambient-notification-changed", null);//XX which args?
      },
      setCounter: function(counter) {
        icon.counter = counter;
        Services.obs.notifyObservers(null, "social-browsing-ambient-notification-changed", null);//XX which args?
      },
      setContentPanel: function(url) {
        icon.contentPanel = url;
      }
      // XXX change counter color, font, etc?
    };
    this.ambientNotificationIcons[name] = icon;
    return icon;
  },

  setAmbientNotificationPortrait: function(url) {
    this.ambientNotificationPortrait = url;
    Services.obs.notifyObservers(null, "social-browsing-ambient-notification-changed", null);//XX which args?
  }
}
