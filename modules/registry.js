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

const {classes: Cc, interfaces: Ci, utils: Cu, manager: Cm} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialapi/modules/defaultprefs.js");
Cu.import("resource://socialapi/modules/manifestDB.jsm");
//Cu.import("resource://socialapi/modules/defaultServices.jsm");

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const FRECENCY = 100;

/** Helper function to detect "development mode",
 * which is set with the social.provider.devmode pref.
 *
 * When "devmode" is set, service URLs can be served
 * domains other than the manifest's origin.
 */
function isDevMode() {
  let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
  let enable_dev = false;
  try {
    enable_dev = prefBranch.getBoolPref("devmode");
  } catch(e) {}
  return enable_dev;
}

function log(msg) {
  // dump(msg);
}

const providerRegistryClassID = Components.ID("{1a60fb78-b2d2-104b-b16a-7f497be5626d}");
const providerRegistryCID = "@mozilla.org/socialProviderRegistry;1";

function ProviderRegistry(createCallback) {
  log("social registry service initializing\n");
  this.createProviderCallback = createCallback;
  this._prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);

  Services.obs.addObserver(this, "private-browsing", false);
  Services.obs.addObserver(this, 'quit-application', true);

  let self = this;
  ManifestDB.iterate(function(key, manifest) {
    self.register(manifest);
  });

  // developer?
  let enable_dev = isDevMode();

  // we need to have our service injector running on startup of the
  // registry
  this.injectController = function(doc, topic, data) {
    try {
      // if we have attached 'service' on to the social-browser for the window
      // then we'll continue our injection.
      if (!doc.defaultView) return;
      var xulWindow = doc.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
      // our service windows simply have browser attached to them
      var sbrowser = xulWindow.document.getElementById("social-status-sidebar-browser") || xulWindow.browser;
      var panelbrowser = xulWindow.document.getElementById("social-notification-browser");
      if (panelbrowser && panelbrowser.contentDocument == doc) sbrowser = panelbrowser;

      if (sbrowser && sbrowser.contentDocument == doc) {
        let service = sbrowser.service? sbrowser.service : xulWindow.service;
        if (service.workerURL) {
          service.attachToWindow(doc.defaultView);
        }
      } else
      if (enable_dev) {
        // XXX dev code, allows us to load social panels into tabs and still
        // call attachToWindow on them
        for each(let svc in this._providers) {
          if ((doc.location+"").indexOf(svc.origin) == 0) {
            svc.attachToWindow(doc.defaultView);
            break;
          }
        };
      }
    }
    catch(e) {
      Cu.reportError("unable to attachToWindow for "+doc.location+":" + e);
    }
  };
  Services.obs.addObserver(this.injectController.bind(this), 'document-element-inserted', false);
}
ProviderRegistry.prototype = {
  classID: providerRegistryClassID,
  contractID: providerRegistryCID,
  QueryInterface: XPCOMUtils.generateQI([Ci.mozISocialRegistry,
                                         Ci.nsISupportsWeakReference,
                                         Ci.nsIObserver]),

  _providers: {}, // a list of installed social providers
  _currentProvider: null,
  _enabled: null,
  _enabledBeforePrivateBrowsing: false,

  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "private-browsing") {
      if (aData == "enter") {
        this._enabledBeforePrivateBrowsing = this.enabled;
        this.enabled = false;
      } else if (aData == "exit") {
        this.enabled = this._enabledBeforePrivateBrowsing;
      }
    }
    else if (aTopic == 'quit-application') {
      this.each(function(provider) {
        provider.shutdown();
      })
    }
  },

  /**
   * register
   *
   * registers a provider manifest that is installed into the database.  These
   * are available social providers, whether enabled or not.
   *
   * @param manifest jsonObject
   */
  register: function(manifest) {
    // we are not pushing into manifestDB here, rather manifestDB is calling us
    try {
      let provider = this.createProviderCallback(manifest);
      this._providers[manifest.origin] = provider;
      // registration on startup could happen in any order, so we avoid
      // setting this as "current".
      // notify manifest changed so listeners can pick up new providers (e.g.
      // about:social)
      Services.obs.notifyObservers(null, "social-service-manifest-changed", manifest.origin);
    }
    catch(e) {
      Cu.reportError(e);
    }
  },

  /**
   * remove
   *
   * remove a provider from the registry and the database
   *
   * @param origin string scheme+host+port
   * @param callback function
   */
  remove: function(origin, callback) {
    this.disableProvider(origin);
    try {
      delete this._providers[origin];
    } catch (ex) {
      Cu.reportError("attempting to remove a non-existing manifest origin: " + origin);
    }
    ManifestDB.remove(origin, function() {
      Services.obs.notifyObservers(null, "social-service-manifest-changed", origin);
      if (callback) callback();
    });
  },

  _findCurrentProvider: function() {
    // workout what provider should be current.
    if (!this.enabled) {
      throw new Error("_findCurrentProvider should not be called when disabled.");
    }
    let origin = this._prefBranch.getCharPref("current");
    if (origin && this._providers[origin] && this._providers[origin].enabled) {
      return this._providers[origin];
    }
    // can't find it based on our prefs - just select any enabled one.
    for each(let provider in this._providers) {
      if (provider.enabled) {
        // this one will do.
        return provider;
      }
    }
    // should be impossible to get here; our enabled state should be false
    // if there are none we can select.
    return null;
  },
  get currentProvider() {
    // no concept of a "current" provider when we are disabled.
    if (!this.enabled) {
      return null;
    }
    return this._currentProvider;
  },
  set currentProvider(provider) {
    if (provider && !provider.enabled) {
      throw new Error("cannot set disabled provider as the current provider");
    }
    this._currentProvider = provider;
    try {
      this._prefBranch.setCharPref("current", provider.origin);
    }
    catch(e) {
      // just during dev, otherwise we shouldn't log here
      Cu.reportError(e);
    }
    Services.obs.notifyObservers(null,
                                 "social-browsing-current-service-changed",
                                 provider.origin);
  },
  get: function pr_get(origin) {
    return this._providers[origin];
  },
  each: function pr_iterate(cb) {
    for each(let provider in this._providers) {
      //cb.handle(provider);
      cb(provider);
    }
  },
  enableProvider: function(origin, callback) {
    let provider = this._providers[origin];
    if (!provider) {
      return false;
    }

    // Don't start up again if we're already enabled
    if (provider.enabled) return true;

    ManifestDB.get(origin, function(key, manifest) {
      manifest.enabled = true;
      ManifestDB.put(origin, manifest);
      Services.obs.notifyObservers(null, "social-service-manifest-changed", origin);
      if (callback) callback();
    });
    provider.enabled = true;
    // if browsing is disabled we can't activate it!
    // XXX - but checking "this.enabled" will have the side-effect of actually
    // starting things up, which may be too early!  So use the private ._enabled.
    if (this._enabled) {
      provider.activate();
    }
    // nothing else to do - it is now available to be the current provider
    // but doesn't get that status simply because it was enabled.
    return true;
  },
  disableProvider: function(origin, callback) {
    let provider = this._providers[origin];
    if (!provider) {
      return false;
    }

    provider.shutdown();
    provider.enabled = false;
    // and update the manifest.
    // XXX - this is wrong!  We should track that state elsewhere, otherwise
    // a manifest being updated by a provider loses this state!
    ManifestDB.get(origin, function(key, manifest) {
      manifest.enabled = false;
      ManifestDB.put(origin, manifest);
      Services.obs.notifyObservers(null, "social-service-manifest-changed", origin);
      if (callback) callback();
    });

    if (this._currentProvider && this._currentProvider == provider) {
      // it was current select a new current one.
      this._currentProvider = null;
      // however, if this was the last enabled service, then we must disable
      // social browsing completely.
      let numEnabled = 0;
      for each(let look in this._providers) {
        if (look.enabled) {
          numEnabled += 1;
        }
      }
      if (numEnabled == 0) {
        log("provider disabled and no others are enabled - disabling social\n")
        this.enabled = false;
      } else {
        // don't call this.currentProvider as we don't want to set the pref!
        this._currentProvider = this._findCurrentProvider();
        Services.obs.notifyObservers(null,
                                     "social-browsing-current-service-changed",
                                     this._currentProvider.origin);
      }
    }
    return true;
  },

  // the rest of these methods are misplaced and should be in a generic
  // "social service" rather than the registry - but this will do for now
  // The global state of whether social browsing is enabled or not.
  get enabled() {
    if (this._enabled === null) {
      this.enabled = this._prefBranch.getBoolPref("enabled");
    }
    return this._enabled;
  },
  set enabled(new_state) {
    log("registry set enabled " + new_state + " (current state is " + this._enabled + ")\n");
    if (new_state == this._enabled) {
      return;
    }

    // XXX for now, we don't allow enabling social browsing during private browsing
    if (new_state && Components.classes["@mozilla.org/privatebrowsing;1"]
                .getService(Components.interfaces.nsIPrivateBrowsingService)
                .privateBrowsingEnabled)
      return;

    this._enabled = new_state; // set early so later .enabled requests don't recurse.
    if (new_state) {
      for each(let provider in this._providers) {
        provider.activate();
      }
      let current = this._findCurrentProvider();
      if (current == null) {
        log("attempted to enable browsing but no providers available\n");
        this._enabled = false;
        return;
      }
      // Set the current provider so anyone who asks as a result of the
      // social-browsing-enabled gets the right answer, but don't broadcast
      // about the new default until after,
      this._currentProvider = current;
      Services.obs.notifyObservers(null, "social-browsing-enabled", null);
      Services.obs.notifyObservers(null, "social-browsing-current-service-changed", null);
    } else {
      for each(let provider in this._providers) {
        provider.shutdown();
      }
      this._currentProvider = null;
      Services.obs.notifyObservers(null, "social-browsing-disabled", null);
    }
    this._prefBranch.setBoolPref("enabled", new_state);
  },
}

//const components = [ProviderRegistry];
//const NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
let providerRegistrySingleton;

function initialize(createCallback) {
  if (providerRegistrySingleton) {
    throw new Error("already initialized");
  }
  providerRegistrySingleton = new ProviderRegistry(createCallback);
}

function registry() providerRegistrySingleton;
const EXPORTED_SYMBOLS = ["registry", "initialize", "isDevMode"];
