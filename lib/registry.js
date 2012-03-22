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
Cu.import("resource://socialdev/lib/provider.js");
Cu.import("resource://socialdev/lib/manifestDB.jsm");
Cu.import("resource://socialdev/lib/defaultServices.jsm");
Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/unload+.js");

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const FRECENCY = 100;


/**
 * manifestRegistry is our internal api for registering manfist files that
   contain data for various services. It holds a registry of installed activity
   handlers, their mediators, and allows for invoking a mediator for installed
   services.
 */
function ManifestRegistry() {
  Services.obs.addObserver(this, "document-element-inserted", true);
  //Services.obs.addObserver(this, "origin-manifest-registered", true);
  //Services.obs.addObserver(this, "origin-manifest-unregistered", true);
  // later we can hook into webapp installs
  //Services.obs.addObserver(this, "openwebapp-installed", true);
  //Services.obs.addObserver(this, "openwebapp-uninstalled", true);

  installBuiltins();
}

const manifestRegistryClassID = Components.ID("{8d764216-d779-214f-8da0-80e211d759eb}");
const manifestRegistryCID = "@mozilla.org/manifestRegistry;1";

ManifestRegistry.prototype = {
  classID: manifestRegistryClassID,
  contractID: manifestRegistryCID,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver]),

  _getUsefulness: function manifestRegistry_findMeABetterName(url, loginHost) {
    let hosturl = Services.io.newURI(url, null, null);
    loginHost = loginHost || hosturl.scheme+"://"+hosturl.host;
    return {
      hasLogin: hasLogin(loginHost),
      frecency: frecencyForUrl(hosturl.host)
    }
  },

  askUserInstall: function(aWindow, aCallback) {
    // BUG 732263 remember if the user says no, use that as a check in
    // discoverActivity so we bypass a lot of work.
    let nId = "manifest-ask-install";
    let nBox = aWindow.gBrowser.getNotificationBox();
    let notification = nBox.getNotificationWithValue(nId);

    // Check that we aren't already displaying our notification
    if (!notification) {
      let message = "This site supports additional functionality for Firefox, would you like to install it?";

      buttons = [{
        label: "Yes",
        accessKey: null,
        callback: function () {
          aWindow.setTimeout(function () {
            aCallback();
          }, 0);
        }
      }];
      nBox.appendNotification(message, nId, null,
                  nBox.PRIORITY_INFO_MEDIUM, buttons);
    }
  },

  importManifest: function manifestRegistry_importManifest(aDocument, location, manifest, userRequestedInstall) {
    //console.log("got manifest "+JSON.stringify(manifest));

    let registry = this;
    function installManifest() {
      manifest.origin = location; // make this an origin
      // ensure remote installed social services cannot set contentPatchPath
      manifest.contentPatchPath = undefined;
      manifest.enabled = true;
      ManifestDB.put(location, manifest);
      providerRegistryService.register(manifest);
      // XXX notification of installation
    }

    if (userRequestedInstall) {
      installManifest();
    }
    else {
      let info = this._getUsefulness(location);
      if (!info.hasLogin && info.frecency < FRECENCY) {
        //console.log("this site simply is not important, skip it");
        return;
      }
      // we reached here because the user has a login or visits this site
      // often, so we want to offer an install to the user
      //console.log("installing "+location+ " because "+JSON.stringify(info));
      // prompt user for install
      var xulWindow = aDocument.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
      this.askUserInstall(xulWindow, installManifest)
      return;
    }
  },

  loadManifest: function manifestRegistry_loadManifest(aDocument, url, userRequestedInstall) {
    // BUG 732264 error and edge case handling
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.open('GET', url, true);
    let registry = this;
    xhr.onreadystatechange = function(aEvt) {
      if (xhr.readyState == 4) {
        if (xhr.status == 200 || xhr.status == 0) {
          //console.log("got response "+xhr.responseText);
          try {
            registry.importManifest(aDocument, url, JSON.parse(xhr.responseText), userRequestedInstall);
          } catch(e) {
            console.log("importManifest: "+e);
          }
        } else {
          console.log("got status "+xhr.status);
        }
      }
    };
    //console.log("fetch "+url);
    xhr.send(null);
  },

  discoverManifest: function manifestRegistry_discoverManifest(aDocument, aData) {
    // BUG 732266 this is probably heavy weight, is there a better way to watch for
    // links in documents?

    // TODO determine whether or not we actually want to load this
    // manifest.
    // 1. is it already loaded, skip it, we'll check it for updates another
    //    way
    // 2. does the user have a login for the site, if so, load it
    // 3. does the fecency for the site warrent loading the manifest and
    //    offering to the user?
    let self = this;
    let links = aDocument.getElementsByTagName('link');
    for (let index=0; index < links.length; index++) {
      let link = links[index];
      if (link.getAttribute('rel') == 'manifest' &&
          link.getAttribute('type') == 'text/json') {
        //console.log("found manifest url "+link.getAttribute('href'));
        let baseUrl = aDocument.defaultView.location.href;
        let url = Services.io.newURI(baseUrl, null, null).resolve(link.getAttribute('href'));
        //console.log("base "+baseUrl+" resolved to "+url);
        ManifestDB.get(url, function(item) {
          if (!item) {
            self.loadManifest(aDocument, url);
          }
        });
      }
    }
  },

  /**
   * observer
   *
   * reset our mediators if an app is installed or uninstalled
   */
  observe: function manifestRegistry_observe(aSubject, aTopic, aData) {
    if (aTopic == "document-element-inserted") {
      if (!aSubject.defaultView)
        return;
      //console.log("new document "+aSubject.defaultView.location);
      this.discoverManifest(aSubject, aData);
      return;
    }
  },

  /**
   * get
   *
   * Return the mediator instance handling this activity, create one if one
   * does not exist.
   *
   * @param  jsobject activity
   * @return MediatorPanel instance
   */
  get: function manifestRegistry_get(cb) {
    ManifestDB.iterate(function(key, manifest) {
      cb(manifest);
    });
  }
};


function ProviderRegistry() {
  this._prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);

  Services.obs.addObserver(this, 'social-service-enabled', false);
  Services.obs.addObserver(this, 'social-service-disabled', false);
  Services.obs.addObserver(this, 'social-browsing-enabled', false);
  Services.obs.addObserver(this, 'social-browsing-disabled', false);

  let self = this;
  unload(function() {
    try {
      this._prefBranch.setCharPref("current", this._currentProvider.origin);
    } catch(e) {
      // just during dev, otherwise we shouldn't log here
      //Cu.reportError(e);
    }
    self.iterate(function(provider) {
      provider.shutdown();
    })
  });
}
ProviderRegistry.prototype = {
  _providers: {},
  _currentProvider: null,

  observe: function(aSubject, aTopic, aData) {
    let provider = this._providers[aData]
    if (aTopic == 'social-service-disabled') {
      provider.enabled = false;
      let nextProvider = null;
      if (provider == this.currentProvider) {
        // just select the first one we have, if none, then disable browsing
        for each(let provider in this._providers) {
          if (provider.enabled) {
            nextProvider = provider;
            break;
          }
        }
        if (nextProvider) {
          this.currentProvider = nextProvider;
        }
        else {
          Services.obs.notifyObservers(null, "social-browsing-disabled", null);
          this.currentProvider = null;
        }
      }
      provider.deactivate();
      ManifestDB.get(aData, function(manifest) {
        manifest.enabled = false;
        ManifestDB.put(aData, manifest);
      });
    }
    else if (aTopic == 'social-service-enabled') {
      ManifestDB.get(aData, function(manifest) {
        manifest.enabled = true;
        ManifestDB.put(aData, manifest);
      });
      provider.enabled = true;
      provider.activate();
      if (!this.currentProvider)
        this.currentProvider = provider;
    }
    else if (aTopic == 'social-browsing-enabled') {
      this.each(function(svc) { svc.activate(); });
    }
    else if (aTopic == 'social-browsing-disabled') {
      this.each(function(svc) { if (svc.active) svc.deactivate(); });
    }
  },

  init: function() {
    // we really need to have this be an xpcom service
    let self = this;
    manifestRegistryService.get(function(manifest) {
      self.register(manifest);
    });
  },
  register: function(manifest) {
    // we are not pushing into manifestDB here, rather manifestDB is calling us
    dump("registering "+manifest.origin+"\n");
    try {
      let provider = new SocialProvider(manifest);
      this._providers[manifest.origin] = provider
      if (!this._currentProvider && provider.enabled)
        this.currentProvider = this._providers[manifest.origin];
    } catch(e) {
      Cu.reportError(e);
    }
    // double check and make sure we're setting the right provider
    try {
      var currentProviderOrigin = this._prefBranch.getCharPref("current");
      let provider = this._providers[currentProviderOrigin];
      if (provider && provider.enabled) {
        this.currentProvider = provider;
      }
    } catch(e) {
      // just during dev, otherwise we shouldn't log here
      //Cu.reportError(e);
    }
  },
  get currentProvider() {
    return this._currentProvider;
  },
  set currentProvider(provider) {
    if (!provider.enabled) {
      throw new Error("cannot set disabled provider as the current provider");
    }
    this._currentProvider = provider;
    try {
      this._prefBranch.setCharPref("current", provider.origin);
    } catch(e) {
      // just during dev, otherwise we shouldn't log here
      //Cu.reportError(e);
    }
    Services.obs.notifyObservers(null, "social-service-changed", provider.origin);
  },
  get: function pr_get(origin) {
    return this._providers[origin];
  },
  getByOrigin: function pr_getByOrigin(origin) {
    return this._providers[origin];
  },
  each: function pr_iterate(cb) {
    for each(let provider in this._providers) {
      cb(provider);
    }
  }
}

//const components = [manifestRegistry];
//const NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
const manifestRegistryService = new ManifestRegistry();
const providerRegistryService = new ProviderRegistry();

function manifestRegistry() {
  return manifestRegistryService;
}
function providerRegistry() {
  return providerRegistryService;
}
const EXPORTED_SYMBOLS = ["manifestRegistry", "providerRegistry"];
