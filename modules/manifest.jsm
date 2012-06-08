/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Shane Caraveo <scaraveo@mozilla.com>
 *
 * Utility methods for dealing with service manifests.
 */

const {classes: Cc, interfaces: Ci, utils: Cu, manager: Cm} = Components;
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialapi/modules/manifestDB.jsm");
Cu.import("resource://socialapi/modules/registry.js");
Cu.import("resource://socialapi/modules/SafeXHR.jsm");


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


/**
 * manifestRegistry is our internal api for registering manifest files that
   contain data for various services.   It interacts with ManifestDB to
   store a list of service manifests, keyed on domain.
 */
function ManifestRegistry() {
  this._prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
}

const manifestRegistryClassID = Components.ID("{8d764216-d779-214f-8da0-80e211d759eb}");
const manifestRegistryCID = "@mozilla.org/manifestRegistry;1";

ManifestRegistry.prototype = {
  classID: manifestRegistryClassID,
  contractID: manifestRegistryCID,
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupportsWeakReference, Ci.nsIObserver]),

  askUserInstall: function(aWindow, aCallback, location) {
    let origin = normalizeOriginPort(location);
    // BUG 732263 remember if the user says no, use that as a check in
    // discoverActivity so we bypass a lot of work.
    let nId = "manifest-ask-install";
    let nBox = aWindow.gBrowser.getNotificationBox();
    let notification = nBox.getNotificationWithValue(nId);
    let strings = Services.strings.createBundle("chrome://socialapi/locale/strings.properties");

    // Check that we aren't already displaying our notification
    if (!notification) {
      let self = this;
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
          self._prefBranch.setBoolPref(origin+".ignore", true);
        }
      }];
      nBox.appendNotification(message, nId, null,
                nBox.PRIORITY_INFO_MEDIUM,
                buttons);
    }
  },

  importManifest: function manifestRegistry_importManifest(aDocument, location, rawManifest, systemInstall, callback) {
    //Services.console.logStringMessage("got manifest "+JSON.stringify(manifest));
    let manifest = ManifestDB.validate(location, rawManifest);

    if (systemInstall) {
      // user approval has already been granted, or this is an automatic operation
      ManifestDB.install(manifest);
    }
    else {
      // we need to ask the user for confirmation:
      var xulWindow = aDocument.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIWebNavigation)
                     .QueryInterface(Ci.nsIDocShellTreeItem)
                     .rootTreeItem
                     .QueryInterface(Ci.nsIInterfaceRequestor)
                     .getInterface(Ci.nsIDOMWindow);
      this.askUserInstall(xulWindow, function() {
        ManifestDB.install(manifest);

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

  loadManifest: function manifestRegistry_loadManifest(aDocument, url, systemInstall, callback) {
    // test any manifest against safebrowsing
    let self = this;
    SafeXHR.get(uri, true, function(data) {
      if (data) {
        self.importManifest(aDocument, url, JSON.parse(data), systemInstall, callback);
      }
    });
  }
};

const manifestSvc = new ManifestRegistry();
const EXPORTED_SYMBOLS = ['manifestSvc'];
