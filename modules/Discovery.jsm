/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *  Shane Caraveo <scaraveo@mozilla.com>
 *  Mark Hammond <mhammond@mozilla.com>
 *
 *
 *
 *  Discovery contains all UI/UX and utility functionality around installing
 *  social service providers from remote websites.
 */


const {classes: Cc, interfaces: Ci, utils: Cu, manager: Cm} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialapi/modules/registry.js");
Cu.import("resource://socialapi/modules/ManifestRegistry.jsm");
Cu.import("resource://socialapi/modules/SafeXHR.jsm");


// some utility functions we can later use to determin if a "builtin" should
// be made available or not

function hasLogin(hostname) {
  try {
    return Services.logins.countLogins(hostname, "", "") > 0;
  } catch(e) {
    Cu.reportError(e);
  }
  return false;
}

function reverse(s){
    return s.split("").reverse().join("");
}

function frecencyForUrl(host)
{
  // BUG 732275 there has got to be a better way to do this!
  Cu.import("resource://gre/modules/PlacesUtils.jsm");

  let dbconn = PlacesUtils.history.QueryInterface(Ci.nsPIPlacesDatabase)
                                  .DBConnection;
  let frecency = 0;
  let stmt = dbconn.createStatement(
    "SELECT frecency FROM moz_places WHERE rev_host = ?1"
  );
  try {
    stmt.bindByIndex(0, reverse(host)+'.');
    if (stmt.executeStep())
      frecency = stmt.getInt32(0);
  } finally {
    stmt.finalize();
  }

  return frecency;
}

/* Utility function: returns the host:port of
 * of a URI, or simply the host, if no port
 * is provided.  If the URI cannot be parsed,
 * or is a resource: URI, returns the input
 * URI text. */
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

var SocialProviderDiscovery = (function() {
  let _prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);

  function askUserInstall(aWindow, aCallback, location) {
    let origin = normalizeOriginPort(location);
    // BUG 732263 remember if the user says no, use that as a check in
    // discoverActivity so we bypass a lot of work.
    let nId = "manifest-ask-install";
    let nBox = aWindow.gBrowser.getNotificationBox();
    let notification = nBox.getNotificationWithValue(nId);
    let strings = Services.strings.createBundle("chrome://socialapi/locale/strings.properties");

    // Check that we aren't already displaying our notification
    if (!notification) {
      let message = strings.GetStringFromName("installoffer.notificationbar");

      buttons = [{
        label: strings.GetStringFromName("yes.label"),
        accessKey: null,
        callback: function () {
          aWindow.setTimeout(function () {
            aCallback();
          }, 0);
        }
      },
      {
        label: strings.GetStringFromName("dontask.label"),
        accessKey: strings.GetStringFromName("dontask.accesskey"),
        callback: function() {
          _prefBranch.setBoolPref(origin+".ignore", true);
        }
      }];
      nBox.appendNotification(message, nId, null,
                nBox.PRIORITY_INFO_MEDIUM,
                buttons);
    }
  }

  function importManifest(aDocument, location, rawManifest, systemInstall, callback) {
    //Services.console.logStringMessage("got manifest "+JSON.stringify(manifest));
    let manifest = ManifestRegistry.validate(location, rawManifest);

    if (systemInstall) {
      // user approval has already been granted, or this is an automatic operation
      ManifestRegistry.install(manifest);
    }
    else {
      // we need to ask the user for confirmation:
      var xulWindow = aDocument.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
      askUserInstall(xulWindow, function() {
        ManifestRegistry.install(manifest);

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
  }

  function loadManifest(aDocument, url, systemInstall, callback) {
    // test any manifest against safebrowsing
    SafeXHR.get(uri, true, function(data) {
      if (data) {
        importManifest(aDocument, url, JSON.parse(data), systemInstall, callback);
      }
    });
  }

  function discoverManifest(aDocument, aData) {
    // BUG 732266 this is probably heavy weight, is there a better way to watch for
    // links in documents?
    // https://developer.mozilla.org/En/Listening_to_events_in_Firefox_extensions
    // DOMLinkAdded event
    let _prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);;

    // TODO determine whether or not we actually want to load this
    // manifest.
    // 1. is it already loaded, skip it, we'll check it for updates another
    //    way
    // 2. does the user have a login for the site, if so, load it
    // 3. does the fecency for the site warrent loading the manifest and
    //    offering to the user?
    try {
      if (_prefBranch.getBoolPref(aDocument.defaultView.location.host+".ignore")) {
        return;
      }
    } catch(e) {}

    // we need a way to test against local non-http servers on occasion
    let allow_http = false;
    try {
      allow_http = _prefBranch.getBoolPref("devmode");
    } catch(e) {}

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
        ManifestRegistry.get(url, function(key, item) {
          if (!item) {
            loadManifest(aDocument, url);
          }
        });
      }
    }
  }

  /**
   * observer
   *
   * reset our mediators if an app is installed or uninstalled
   */
  var DocumentObserver = {
    QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver]),
    observe: function DocumentObserver_observe(aSubject, aTopic, aData) {
      if (aTopic == "document-element-inserted") {
        if (!aSubject.defaultView)
          return;
        //Services.console.logStringMessage("new document "+aSubject.defaultView.location);
        discoverManifest(aSubject, aData);
        return;
      }
    }
  }

  Services.obs.addObserver(DocumentObserver, "document-element-inserted", true);

  return {
    loadManifest: loadManifest,
    importManifest: importManifest
  }
})();

const EXPORTED_SYMBOLS = ["SocialProviderDiscovery"];
