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
Cu.import("resource://socialdev/modules/defaultprefs.js");
Cu.import("resource://socialdev/modules/provider.js");
Cu.import("resource://socialdev/modules/manifestDB.jsm");
Cu.import("resource://socialdev/modules/defaultServices.jsm");

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const FRECENCY = 100;

function normalizeOriginPort(aURL) {
  try {
    let uri = Services.io.newURI(aURL, null, null);
    if (uri.scheme == 'resource') return aURL;
    return uri.hostPort;
  }
  catch(e) {
    Cu.reportError(e);
  }
  return aURL;
}

function isDevMode() {
  prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
  let enable_dev = false;
  try {
    enable_dev = prefBranch.getBoolPref("devmode");
  } catch(e) {}
  return enable_dev;
}

/**
 * testSafebrowsing
 *
 * given a url, see if it is in our malware/phishing lists.
 * Callback gets one param, the result which will be non-zero
 * if the url is a problem.
 *
 * @param url string
 * @param callback function
 */
function testSafebrowsing(aUrl, aCallback) {
  // callback gets zero if the url is not found
  // pills.ind.in produces a positive hit for a bad site
  // http://www.google.com/safebrowsing/diagnostic?site=pills.ind.in/
  // result is non-zero if the url is in the malware or phising lists
  let uri = Services.io.newURI(aUrl, null, null);
  var dbservice = Cc["@mozilla.org/url-classifier/dbservice;1"]
                      .getService(Ci.nsIUrlClassifierDBService);
  var handler = {
    onClassifyComplete: function(result) {
      aCallback(result);
    }
  }
  var classifier = dbservice.QueryInterface(Ci.nsIURIClassifier);
  var result = classifier.classify(uri, handler);
  if (!result) {
    // the callback will not be called back, do it ourselves
    aCallback(0);
  }
}


/**
 * getDefaultProviders
 *
 * look into our addon/feature dir and see if we have any builtin providers to install
 */
function getDefaultProviders() {
  var URIs = [];
  try {
    // figure out our installPath
    let res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    let installURI = Services.io.newURI("resource://socialdev/", null, null);
    let installPath = res.resolveURI(installURI);
    let installFile = Services.io.newURI(installPath, null, null);
    try {
      installFile = installFile.QueryInterface(Components.interfaces.nsIJARURI);
    } catch (ex) {} //not a jar file

    // load all prefs in defaults/preferences into a sandbox that has
    // a pref function
    let resURI = Services.io.newURI("resource://socialdev/providers", null, null);
    // If we're a XPI, load from the jar file
    if (installFile.JARFile) {
      let fileHandler = Components.classes["@mozilla.org/network/protocol;1?name=file"].
                  getService(Components.interfaces.nsIFileProtocolHandler);
      let fileName = fileHandler.getFileFromURLSpec(installFile.JARFile.spec);
      let zipReader = Cc["@mozilla.org/libjar/zip-reader;1"].
                      createInstance(Ci.nsIZipReader);
      try {
        zipReader.open(fileName);
        let entries = zipReader.findEntries("providers/*");
        while (entries.hasMore()) {
          var entryName = resURI.resolve(entries.getNext());
          if (entryName.indexOf("app.manifest") >= 0)
            URIs.push(entryName);
        }
      }
      finally {
        zipReader.close();
      }
    }
    else {
      let fURI = resURI.QueryInterface(Components.interfaces.nsIFileURL).file;

      var entries = fURI.directoryEntries;
      while (entries.hasMoreElements()) {
        var entry = entries.getNext();
        entry.QueryInterface(Components.interfaces.nsIFile);
        if (entry.leafName.length > 0 && entry.leafName[0] != '.') {
          URIs.push(resURI.resolve("providers/"+entry.leafName+"/app.manifest"));
        }
      }
    }
    //dump(JSON.stringify(URIs)+"\n");
  } catch(e) {
    Cu.reportError(e);
  }
  return URIs
}


/**
 * manifestRegistry is our internal api for registering manfist files that
   contain data for various services. It holds a registry of installed activity
   handlers, their mediators, and allows for invoking a mediator for installed
   services.
 */
function ManifestRegistry() {
  this._prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
  Services.obs.addObserver(this, "document-element-inserted", true);
  //Services.obs.addObserver(this, "origin-manifest-registered", true);
  //Services.obs.addObserver(this, "origin-manifest-unregistered", true);
  // later we can hook into webapp installs
  //Services.obs.addObserver(this, "openwebapp-installed", true);
  //Services.obs.addObserver(this, "openwebapp-uninstalled", true);

  // load the builtin providers if any
  let URIs = getDefaultProviders();
  for each(let uri in URIs) {
    this.loadManifest(null, uri, true);
  }
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

  askUserInstall: function(aWindow, aCallback, location) {
    let origin = normalizeOriginPort(location);
    // BUG 732263 remember if the user says no, use that as a check in
    // discoverActivity so we bypass a lot of work.
    let nId = "manifest-ask-install";
    let nBox = aWindow.gBrowser.getNotificationBox();
    let notification = nBox.getNotificationWithValue(nId);

    // Check that we aren't already displaying our notification
    if (!notification) {
      let self = this;
      let message = "This site supports additional functionality for Firefox, would you like to install it?";

      buttons = [{
        label: "Yes",
        accessKey: null,
        callback: function () {
          aWindow.setTimeout(function () {
            aCallback();
          }, 0);
        }
      },
      {
        label: "Don't ask again",
        accessKey: 'd',
        callback: function() {
          self._prefBranch.setBoolPref(origin+".ignore", true);
        }
      }];
      nBox.appendNotification(message, nId, null,
                nBox.PRIORITY_INFO_MEDIUM,
                buttons);
    }
  },

  /**
   * validateManifest
   *
   * Given the manifest data, create a clean version of the manifest.  Ensure
   * any URLs are same-origin (proto+host+port).  If the manifest is a builtin,
   * URLs must either be resource or same-origin resolved against the manifest
   * origin. We ignore any manifest entries that are not supported.
   *
   * @param location   string      string version of manifest location
   * @param manifest   json-object raw manifest data
   * @returns manifest json-object a cleaned version of the manifest
   */
  validateManifest: function manifestRegistry_validateManifest(location, rawManifest) {
    // anything in URLEntries will require same-origin policy, though we
    // special-case iconURL to allow icons from CDN
    let URLEntries = ['iconURL', 'workerURL', 'sidebarURL'];
    // only items in validEntries will move into our cleaned manifest
    let validEntries = ['name'].concat(URLEntries);
    let builtin = location.indexOf("resource:") == 0;
    if (builtin) {
      // builtin manifests may have a couple other entries
      validEntries = validEntries.concat('origin', 'contentPatchPath');
    }
    // store the location we got the manifest from and the origin.
    let manifest = {
      location: location
    };
    for (var k in rawManifest.services.social) {
      if (validEntries.indexOf(k) >= 0) manifest[k] = rawManifest.services.social[k];
    }
    // we've saved original location in manifest above, switch our location
    // temporarily so we can correctly resolve urls for our builtins.  We
    // still valide the origin defined in a builtin manifest below.
    if (builtin && manifest.origin) {
      location = manifest.origin;
    }
    // resolve all URLEntries against the manifest location.
    let basePathURI = Services.io.newURI(location, null, null);
    // full proto+host+port origin for resolving same-origin urls
    manifest.origin = basePathURI.prePath;
    for each(let k in URLEntries) {
      if (!manifest[k]) continue;
      // shortcut - resource:// URIs don't get same-origin checks.
      if (builtin && manifest[k].indexOf("resource:") == 0) continue;
      // resolve the url to the basepath to handle relative urls, then verify
      // same-origin, we'll let iconURL be on a different origin
      let url = basePathURI.resolve(manifest[k]);
      if (k != 'iconURL' && url.indexOf(manifest.origin) != 0) {
        throw new Error("manifest url origin mismatch " +manifest.origin+ " != " + manifest[k] +"\n")
      }
      manifest[k] = url; // store the resolved version
    }
    //dump("manifest "+JSON.stringify(manifest)+"\n");
    return manifest;
  },

  importManifest: function manifestRegistry_importManifest(aDocument, location, rawManifest, systemInstall, callback) {
    //Services.console.logStringMessage("got manifest "+JSON.stringify(manifest));
    let manifest = this.validateManifest(location, rawManifest);

    // we want automatic updates to the manifest entry if we change our
    // builtin manifest files.   We also want to allow the "real" provider
    // to overwrite our builtin manifest, however we NEVER want a builtin
    // manifest to overwrite something installed from the "real" provider
    function installManifest() {
      ManifestDB.get(manifest.origin, function(key, item) {
        // dont overwrite a non-resource entry with a resource entry.
        if (item && manifest.location.indexOf('resource:') == 0 &&
                    item.location.indexOf('resource:') != 0) {
          // being passed a builtin and existing not builtin - ignore.
          if (callback) {
            callback(false);
          }
          return;
        }
        // dont overwrite enabled, but first install is always enabled
        manifest.enabled = item ? item.enabled : true;
        ManifestDB.put(manifest.origin, manifest);
        registry().register(manifest);
        if (callback) {
          callback(true);
        }
      });
    }

    if (systemInstall) {
      installManifest();
    }
    else {
      let info = this._getUsefulness(location);
      if (!info.hasLogin && info.frecency < FRECENCY) {
        //Services.console.logStringMessage("this site simply is not important, skip it");
        return;
      }
      // we reached here because the user has a login or visits this site
      // often, so we want to offer an install to the user
      //Services.console.logStringMessage("installing "+location+ " because "+JSON.stringify(info));
      // prompt user for install
      var xulWindow = aDocument.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
      this.askUserInstall(xulWindow, function() {
        installManifest();
        // user requested install, lets make sure we enable after the install.
        // This is especially important on first time install.
        registry().enabled = true;
        let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
        prefBranch.setBoolPref("visible", true);
        Services.obs.notifyObservers(null,
                                 "social-browsing-enabled",
                                 registry().currentProvider.origin);
      }, location)
      return;
    }
  },

  _checkManifestSecurity: function(channel) {
    // this comes from https://developer.mozilla.org/En/How_to_check_the_security_state_of_an_XMLHTTPRequest_over_SSL
    // although we are more anal about things (ie, secInfo MUST be a nsITransportSecurityInfo and a nsISSLStatusProvider)
    let secInfo = channel.securityInfo;
    if (!(secInfo instanceof Ci.nsITransportSecurityInfo) || ((secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_SECURE) != Ci.nsIWebProgressListener.STATE_IS_SECURE)) {
      Cu.reportError("The social manifest securityState is not secure");
      return false;
    }
    if (!(secInfo instanceof Ci.nsISSLStatusProvider)) {
      Cu.reportError("The social manifest host has no SSLStatusProvider");
      return false;
    }
    let cert = secInfo.QueryInterface(Ci.nsISSLStatusProvider)
               .SSLStatus.QueryInterface(Ci.nsISSLStatus).serverCert;
    let verificationResult = cert.verifyForUsage(Ci.nsIX509Cert.CERT_USAGE_SSLServer);
    if (verificationResult != Ci.nsIX509Cert.VERIFIED_OK) {
      Cu.reportError("The SSL status of the manifest host is invalid");
      return false;
    }
    return true;
  },

  loadManifest: function manifestRegistry_loadManifest(aDocument, url, systemInstall, callback) {
    // test any manifest against safebrowsing
    let self = this;
    testSafebrowsing(url, function(result) {
      if (result != 0) {
        Cu.reportError("unable to load manifest due to safebrowsing result: ["+result+"] "+url);
        if (callback) callback(false);
        return;
      }

      // BUG 732264 error and edge case handling
      let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function(aEvt) {
        if (xhr.readyState == 4) {
          if (xhr.status == 200 || xhr.status == 0) {
            //Services.console.logStringMessage("got response "+xhr.responseText);
            // We implicitly trust resource:// manifest origins.
            let needSecureManifest = !isDevMode() && url.indexOf("resource://") != 0;
            if (needSecureManifest && !self._checkManifestSecurity(xhr.channel)) {
              if (callback) callback(false);
              return;
            }
            try {
              self.importManifest(aDocument, url, JSON.parse(xhr.responseText), systemInstall, callback);
            }
            catch(e) {
              Cu.reportError("importManifest "+url+": "+e);
              if (callback) callback(false);
            }
          }
          else {
            Services.console.logStringMessage("got status "+xhr.status);
          }
        }
      };
      //Services.console.logStringMessage("fetch "+url);
      xhr.send(null);
    });
  },

  discoverManifest: function manifestRegistry_discoverManifest(aDocument, aData) {
    // BUG 732266 this is probably heavy weight, is there a better way to watch for
    // links in documents?
    // https://developer.mozilla.org/En/Listening_to_events_in_Firefox_extensions
    // DOMLinkAdded event

    // TODO determine whether or not we actually want to load this
    // manifest.
    // 1. is it already loaded, skip it, we'll check it for updates another
    //    way
    // 2. does the user have a login for the site, if so, load it
    // 3. does the fecency for the site warrent loading the manifest and
    //    offering to the user?
    try {
      if (this._prefBranch.getBoolPref(aDocument.defaultView.location.host+".ignore")) {
        return;
      }
    } catch(e) {}

    // we need a way to test against local non-http servers on occasion
    let allow_http = false;
    try {
      allow_http = this._prefBranch.getBoolPref("allow_http");
    } catch(e) {}

    let self = this;
    let links = aDocument.getElementsByTagName('link');
    for (let index=0; index < links.length; index++) {
      let link = links[index];
      if (link.getAttribute('rel') == 'manifest' &&
          link.getAttribute('type') == 'text/json') {
        //Services.console.logStringMessage("found manifest url "+link.getAttribute('href'));
        let baseUrl = aDocument.defaultView.location.href;
        let url = Services.io.newURI(baseUrl, null, null).resolve(link.getAttribute('href'));
        let resolved = Services.io.newURI(url, null, null);
        // we only allow remote manifest files loaded from https
        if (!allow_http && resolved.scheme != "https")
          return;
        //Services.console.logStringMessage("base "+baseUrl+" resolved to "+url);
        ManifestDB.get(url, function(key, item) {
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
      //Services.console.logStringMessage("new document "+aSubject.defaultView.location);
      this.discoverManifest(aSubject, aData);
      return;
    }
  }
};


const providerRegistryClassID = Components.ID("{1a60fb78-b2d2-104b-b16a-7f497be5626d}");
const providerRegistryCID = "@mozilla.org/socialProviderRegistry;1";

function ProviderRegistry() {
  dump("social registry service initializing\n");
  this.manifestRegistry = new ManifestRegistry();
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
      dump(e.stack+"\n");
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
      let provider = new SocialProvider(manifest);
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
  enableProvider: function(origin) {
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
  disableProvider: function(origin) {
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
        dump("provider disabled and no others are enabled - disabling social\n")
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
    dump("registry set enabled " + new_state + " (current state is " + this._enabled + ")\n");
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
        dump("attempted to enable browsing but no providers available\n");
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

providerRegistrySinglton = new ProviderRegistry();
function registry() providerRegistrySinglton;
const EXPORTED_SYMBOLS = ["registry"];
