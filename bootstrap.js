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


const OVERLAYS = [
  {
    overlay: "chrome://browser/content/browser.xul",
    documents: [
      "chrome://socialdev/content/overlay.xul"
    ],
    scripts: [
      //"chrome://socialdev/content/recommendButtonWidget.js",
      //"chrome://socialdev/content/toolbarStatusWidget.js",
      //"chrome://socialdev/content/sidebarWidget.js",
      //"chrome://socialdev/content/main.js"
    ],
    styles: [
      "chrome://socialdev/skin/browser.css",
      "chrome://socialdev-plat/skin/socialstatus.css"
    ]
  },
  {
    overlay: "chrome://socialdev/content/serviceWindow.xul",
    OS: "WINNT",
    documents: [
      "chrome://socialdev/content/winSocial.xul"
    ]
  },
  {
    overlay: "chrome://socialdev/content/serviceWindow.xul",
    OS: "Darwin",
    documents: [
      "chrome://socialdev/content/macBrowserOverlay.xul"
    ]
  }
];


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
try {
  Cu.import("resource://socialdev/components/registry.js");
} catch(e) {
  dump(e+"\n");
}
  // register our xpcom components from the chrome.manifest
  //let manifest = aParams.installPath.clone();
  //manifest.appendRelativePath("chrome.manifest");
  //Cm.autoRegister(manifest);
  
  //let chromeReg = Cc["@mozilla.org/chrome/chrome-registry;1"].
  //                   getService(Ci.nsIXULChromeRegistry);
  //chromeReg.checkForNewChrome();
  //chromeReg.refreshSkins();  // Load the overlay manager

  Cu.import("resource://socialdev/modules/OverlayManager.jsm");

  // XXX because we were using a new interface, we could not be restartless, moving
  // registry back to a module lets us move towards that.
  //OverlayManager.addComponent("{1a60fb78-b2d2-104b-b16a-7f497be5626d}",
  //                            "resource://socialdev/components/registry.js",
  //                            "@mozilla.org/socialProviderRegistry;1");
  //OverlayManager.addCategory("profile-after-change", "socialRegistry",
  //                           "@mozilla.org/socialProviderRegistry;1");
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
  //if (aReason == APP_SHUTDOWN) {
  //  dump("got app_shutdown, return\n");
  //  return;
  //}

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

  //// unregister our xpcom components
  //let compDir = aParams.installPath.clone();
  //compDir.appendRelativePath("chrome.manifest");
  //Cm.autoUnregister(compDir);
  
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
