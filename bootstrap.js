/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Ce = Components.Exception;
const Cr = Components.results;
const Cu = Components.utils;
const Cm = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

Components.utils.import("resource://gre/modules/Services.jsm");


const OVERLAYS = {
  "chrome://browser/content/browser.xul": {
    documents: [
      {overlay: "chrome://socialdev/content/overlay.xul"}
    ]
  },
  "chrome://socialdev/content/serviceWindow.xul": {
    documents: [
      {
        overlay: "chrome://socialdev/content/winSocial.xul",
        OS: "WINNT"
      },
      {
        overlay: "chrome://socialdev/content/macBrowserOverlay.xul",
        OS: "Darwin"
      }
    ]
  }
};


function install(aParams, aReason) {
}

function startup(aParams, aReason) {
  dump("startup started\n");
  Services.console.logStringMessage("socialdev startup called");
  // Register the resource://webapptabs/ mapping
  Cu.import("resource://gre/modules/Services.jsm");
  let res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  res.setSubstitution("socialdev", aParams.resourceURI);

  // Add our chrome registration.  this will spit out warnings about any overlay or
  // component information
  Cm.addBootstrappedManifestLocation(aParams.installPath);

  Cu.import("resource://socialdev/modules/registry.js");
  Cu.import("resource://socialdev/modules/OverlayManager.jsm");

  OverlayManager.addComponent("{ddf3f2e0-c819-b843-b32c-c8834d98ef49}",
                              "resource://socialdev/components/about.js",
                              "@mozilla.org/network/protocol/about;1?what=social");

  OverlayManager.addOverlays(OVERLAYS);
  Services.console.logStringMessage("socialdev startup complete");
  dump("startup complete\n");
}

function shutdown(aParams, aReason) {
  dump("shutdown started\n");
  // Don't need to clean anything up if the application is shutting down
  if (aReason == APP_SHUTDOWN) {
    return;
  }

  // Close any of our UI windows
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    let spec = domWindow.location.toString();
    if (spec.substring(0, 20) == "chrome://socialdev/")
      domWindow.close();
  }

  // Unload and remove the overlay manager
  OverlayManager.unload();
  Cu.unload("resource://socialdev/modules/OverlayManager.jsm");

  // Remove our chrome registration
  Cm.removeBootstrappedManifestLocation(aParams.installPath)

  // Clear our resource registration
  let res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  res.setSubstitution("socialdev", null);

  try {
    if (!Services.prefs.getBoolPref("extensions.socialdev.debug"))
      return;

    // For testing invalidate the startup cache
    Services.obs.notifyObservers(null, "startupcache-invalidate", null);
  }
  catch (e) {
  }
  dump("shutdown completed\n");
}

function uninstall(aParams, aReason) {
}
