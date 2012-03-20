/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *	Edward Lee <edilee@mozilla.com>
 *	Mark Hammond <mhammond@mozilla.com>
 *	Shane Caraveo <scaraveo@mozilla.com>
 */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/listen.js");
Cu.import("resource://socialdev/lib/unload+.js");
Cu.import("resource://socialdev/lib/watchWindows.js");
Cu.import("resource://socialdev/lib/about.js");
Cu.import("resource://socialdev/lib/toolbarButtonWidget.js");
Cu.import("resource://socialdev/lib/recommendButtonWidget.js");

let notification = {};
let provider = {};
try {
  Cu.import("resource://socialdev/lib/registry.js");
  Cu.import("resource://socialdev/lib/notification.js", notification);
  Cu.import("resource://socialdev/lib/provider.js", provider);
} catch(e) {
  console.log("Import error: " + e);
}

Cu.import("resource://socialdev/lib/servicewindow.js");
Cu.import("resource://socialdev/lib/loadStyles.js");

const EXPORTED_SYMBOLS = ["startup", "shutdown"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const isMac = Services.appinfo.OS == "Darwin";

function shutdown(data) {
  runUnloaders();
}

function mainLog(msg) {
  console.log(new Date().toISOString() + " [socialdev]: " + msg);
}

// In main we start up all the services and create
// a window watcher to attach the sidebar element
// to each window.
//
// We also declare a single document-element-inserted
// watcher, which checks each new browser to see
// if it requires API injection.
let injectController;

function startup(options) {
  try {
    _startup(options);
  } catch (ex) {
    mainLog("startup failed:"+ ex);
  }
}

function _startup(options) {
  // Load styles to allow for css transitions
  loadStyles("resource://socialdev/", ["browser"]);

  let registry = providerRegistry();

  // per-window initialization for socialdev
  watchWindows(function(aWindow) {
    try {
      // only attach the sidebar and toolbar stuff if this is not a popup window.
      // according to http://mxr.mozilla.org/mozilla-central/source/browser/base/content/browser.js#1360,
      // the simple check is if the toolbar is visible or not...
      if (!aWindow.toolbar.visible) {
        return;
      }
      let social = aWindow.social = {};

      // Install the sidebar
      attachSidebar(aWindow);

      // Always put a new button in the navbar
      social.toolbarButton = new ToolbarButton(aWindow);
      social.recommendButton = new RecommendButton(aWindow);

      // Helper function, called when a service is ready to go.
      var perWindowServiceReady = function(aService) {
        mainLog("service " + aService.name + " is ready - initializing it");
        // install "Recommend" button in the URL bar
        social.recommendButton.setProvider(aService);
        // XXX - "share" button??

        setVisibleService(aWindow, aService);
      };

      // If the user's newWindow service is ready to go, set it up right away.
      if (registry.currentProvider && registry.currentProvider.active) {
        perWindowServiceReady(registry.currentProvider);
      }
      // If it's not ready to go, take it when it's ready
      Services.obs.addObserver(function(subject, topic, data) {
        mainLog("Observed social-service-init-ready: " + data);
        let service = registry.getNamed(data);
        if (service && service.active && service == registry.currentProvider) {
          perWindowServiceReady(service);
        }
      }, 'social-service-init-ready', false);

    } catch (e) {
      mainLog("window watcher failure:" + e);
      mainLog(e.stack);
    }
  });

  injectController = function(doc, topic, data) {
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
      if (sbrowser && sbrowser.contentDocument == doc) {
        let service = sbrowser.service? sbrowser.service : xulWindow.service;
        service.attachToWindow(doc.defaultView, createServiceWindow);
      }
    } catch(e) {
      mainLog("unable to inject for "+doc.location);
      console.log(e);
    }
  };
  Services.obs.addObserver(injectController, 'document-element-inserted', false);

  // wait till we've setup everything before kicking off
  registry.init();
};


function setVisibleService(aWindow, aService)
{
  mainLog("setVisibleService " + aService.name);

  if (!aService.active) return;// sanity check
  aWindow.displayedSocialService = aService;

  // retarget the sidebar
  var sbrowser = aWindow.document.getElementById("social-status-sidebar-browser");
  sbrowser.service = aService;
  sbrowser.contentWindow.location = aService.sidebarURL;
  sbrowser.visibility = sbrowser._open ? "open" : "minimized";

  // set up a locationwatcher
  try {
    // Keep a reference to the listener so it doesn't get collected
    sbrowser.removeProgressListener(sbrowser.watcher);
    sbrowser.watcher = new LocationWatcher(sbrowser.service.URLPrefix, sbrowser);
    sbrowser.addProgressListener(sbrowser.watcher, Ci.nsIWebProgress.NOTIFY_LOCATION);
  } catch (e) {
    Cu.reportError(e);
  }
}


var providerChangedWatcher = {
  observe: function(aSubject, aTopic, aData) {
    mainLog("**** providerChangedWatcher observed "+aTopic+": "+aData);
    if (aTopic == 'social-service-changed') {
      let service = providerRegistry().getNamed(aData);
      // we should switch all windows now
      let windows = Services.wm.getEnumerator(null);
      while (windows.hasMoreElements()) {
        let window = windows.getNext();
        if (!window.social) continue;
        setVisibleService(window, service);
      }
    }
    else if (aTopic == 'social-service-activated') {
      // we really have nothing to do here....
      let service = providerRegistry().getNamed(aData);
      service.init();
    }
    else if (aTopic == 'social-service-deactivated') {
      let service = providerRegistry().getNamed(aData);
      deactivateService(service);
    }
  }
}
Services.obs.addObserver(providerChangedWatcher, 'social-service-changed', false);
Services.obs.addObserver(providerChangedWatcher, 'social-service-activated', false);
Services.obs.addObserver(providerChangedWatcher, 'social-service-deactivated', false);


function deactivateService(aService)
{
  mainLog("Deactivating social service " + aService.name);

  try {
    // close all service windows associated with this service
    closeWindowsForService(aService);

    // navigate away from it in all sidebars that are displaying it (causing an unload)
    // (should we close the sidebar in this case?)
    let windows = Services.wm.getEnumerator(null);
    while (windows.hasMoreElements()) {
      let window = windows.getNext();
      let sbrowser = window.document.getElementById("social-status-sidebar-browser");
      if (sbrowser) {

        if (sbrowser.contentWindow.location.href.indexOf(aService.URLPrefix) == 0) {
          // this sidebar is displaying this service;
          // turn everything off.
          try {
            sbrowser.removeProgressListener(sbrowser.watcher);
          } catch(e) {
            Cu.reportError(e);
          }
          sbrowser.watcher = null;
          sbrowser.contentWindow.location = "about:blank";
          sbrowser.visibility = "hidden";
          aWindow.social.recommendButton.remove();
          reflowSidebar(window);
        }
      }
    }

    // shut down the worker
    aService.shutdown();
  } catch (e) {
    mainLog("failed to deactivate service: " + e);
  }
}


function reflowSidebar(window) {
  let sbrowser = window.document.getElementById('social-status-sidebar-browser');
  let nav = window.document.getElementById('nav-bar');
  let visibility = sbrowser.visibility;
  if (visibility == "hidden") {
    // just reset the navbar stuff.
    nav.style.paddingRight = "";
    // anything else?
    return;
  }
  let open = visibility == "open";

  if (open)
    window.document.documentElement.classList.add("social-open");
  else
    window.document.documentElement.classList.remove("social-open");

  let tabs = window.document.getElementById("TabsToolbar");
  let vbox = window.document.getElementById('social-vbox');
  let cropper = window.document.getElementById('social-cropper');

  // Include the visual border thickness when calculating navbar height
  let navHeight = nav.clientHeight + (isMac ? 2 : 1);
  let openHeight = window.gBrowser.boxObject.height + navHeight;
  let sideWidth = vbox.getAttribute("width");

  let targetWindow = sbrowser.contentWindow.wrappedJSObject;
  tabs.style.paddingRight = "";
  nav.style.paddingRight = sideWidth + "px";
  cropper.style.height = (open ? openHeight : navHeight) + "px";
  vbox.style.marginLeft = open ? "" : "-" + sideWidth + "px";
  vbox.style.marginTop =  "-" + navHeight + "px";
  sbrowser.style.height = openHeight + "px";

  // TODO XXX Need an API to inform the content page how big to make the header
  var header = targetWindow.document.getElementById("header");
  if (header) {
    var headerStyle = targetWindow.document.getElementById("header").style;
    headerStyle.height = navHeight - 1 + "px";
    headerStyle.overflow = "hidden";
  }
}

function attachSidebarContextMenu(document, vbox) {
  // create a popup menu for the browser.
  // XXX - can we consolidate the context menu with toolbar items etc
  // in a commandset?
  let popupSet = document.getElementById("mainPopupSet");
  let menu = document.createElement("menupopup");
  menu.id = "social-context-menu";
  menu.addEventListener("popupshowing", function(event) {
    let service = providerRegistry().currentProvider;
    if (!service || !service.active) {
      event.preventDefault();
      return ;
    }
    let menuitem = document.createElement( "menuitem" );
    menuitem.setAttribute("label", "Turn off " + service.name);
    menuitem.addEventListener("command", function() {
      deactivateService(service);
    });
    menu.appendChild(menuitem);
    // and a "refresh" menu item.
    menuitem = document.createElement( "menuitem" );
    menuitem.setAttribute("label", "Refresh");
    menuitem.addEventListener("command", function() {
      let sbrowser = document.getElementById("social-status-sidebar-browser");
      sbrowser.contentWindow.location = service.sidebarURL;
    });
    menu.appendChild(menuitem);
  }, false);
  menu.addEventListener("popuphidden", function() {
    let elts = menu.getElementsByTagName("menuitem");
    while (elts.length) {
      menu.removeChild(elts[0]);
    }
  }, false);
  popupSet.appendChild(menu);
  vbox.setAttribute("context", "social-context-menu");
}

// Create the sidebar object for the given window,
// creating a browser element for the services.
function attachSidebar(window)
{
  // End of helper functions - start constructing sidebar:
  let {document, gBrowser} = window;

  // We insert a vbox as a child of 'browser', as an immediate sibling of 'appcontent'
  let vbox = document.createElementNS(XUL_NS, "vbox");
  vbox.setAttribute("id", "social-vbox");
  vbox.setAttribute("width", "240");
  vbox.style.overflow = "hidden";

  let cropper = document.createElementNS(XUL_NS, "vbox");
  cropper.setAttribute("id", "social-cropper");
  cropper.style.overflow = "hidden";
  vbox.appendChild(cropper);

  // Create the sidebar browser
  var sbrowser = document.createElementNS(XUL_NS, "browser");
  sbrowser.setAttribute("id", "social-status-sidebar-browser");
  sbrowser.setAttribute("type", "content");
  sbrowser.setAttribute("flex", "1");
  sbrowser.style.overflow = "hidden";

  // start with the sidebar closed.
  sbrowser._open = false;

  let after = document.getElementById('appcontent');
  let splitter = document.createElementNS(XUL_NS, "splitter");
  splitter.setAttribute("id", "social-splitter");
  splitter.className = "chromeclass-extrachrome";

  // XXX FIX THIS LATER, os-specific css files should be loaded
  splitter.style.mozBorderStart = "none";
  splitter.style.mozBorderEnd = "1px solid #404040";
  splitter.style.minWidth = "1px";
  splitter.style.width = "1px";
  splitter.style.backgroundImage = "none !important";

  // Resize the sidebar when the user drags the splitter
  splitter.addEventListener("mousemove", function() {
    reflowSidebar(window);
  });
  splitter.addEventListener("mouseup", function() {
    reflowSidebar(window);
  });

  document.getElementById('browser').insertBefore(vbox, after.nextSibling);
  document.getElementById('browser').insertBefore(splitter, after.nextSibling);

  cropper.appendChild(sbrowser);

  // Make sure the browser stretches and shrinks to fit
  listen(window, window, "resize", function({target}) {
    if (target == window) {
      reflowSidebar(window);
    }
  });

  // Show full on over, minimize on out
  // Toggle sidebar position states on right-click
  let tabs = document.getElementById("TabsToolbar");
  let nav = document.getElementById("nav-bar");

  var restoreToolbar= function() {
    let tabs = window.document.getElementById("TabsToolbar");
    tabs.style.paddingRight = "";
    var navBar = window.document.getElementById('nav-bar');
    navBar.style.paddingRight = "";
  }

  // XXX hardcode reflowing for the single sbrowser on initial load for now
  sbrowser.addEventListener("DOMContentLoaded", function onLoad() {
    sbrowser.removeEventListener("DOMContentLoaded", onLoad);
    reflowSidebar(window);
  });

  attachSidebarContextMenu(document, vbox);
  // Automatically open (and keep open) the sidebar if minimized when clicked
  vbox.addEventListener("click", function(event) {
    // ack - this is wrong - ideally we want "command" but it doesn't work.
    // check the button so a right-click doesn't do this *and* show the popup
    if (event.button != 0) {
      return;
    }
    if (sbrowser.visibility != "open") {
      sbrowser.visibility = "open";
    }
  });

  Object.defineProperty(sbrowser, "visibility", {
    get: function() {
      if (vbox.getAttribute("hidden") == "true") {
        return "hidden";
      }
      return sbrowser._open ? "open" : "minimized";
    },
    set: function(newVal) {
      let hiddenVal;
      switch (newVal) {
        case "open":
          hiddenVal = false;
          sbrowser._open = true;
          break;
        case "minimized":
          hiddenVal = false;
          sbrowser._open = false;
          break;
        case "hidden":
          hiddenVal = true;
          break;
        default:
          throw "invalid visibility state";
      }
      vbox.setAttribute("hidden", hiddenVal);
      splitter.setAttribute("hidden", hiddenVal);
      reflowSidebar(window);
    }
  });

  // Clean up changes to chrome
  unload(function() {
    vbox.parentNode.removeChild(vbox.previousSibling); // remove splitter
    vbox.parentNode.removeChild(vbox);
    restoreToolbar();
  }, window);

}


function LocationWatcher(prefix, browser) {
  this._prefix = prefix;
  this._browser = browser;
  return this;
}

LocationWatcher.prototype = {
  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIWebProgressListener)   ||
        aIID.equals(Ci.nsIWebProgressListener2)  ||
        aIID.equals(Ci.nsISupportsWeakReference) ||
        aIID.equals(Ci.nsISupports))
      return this;
    throw Cr.NS_NOINTERFACE;
  },
  onStateChange: function(/*in nsIWebProgress*/ aWebProgress,
                     /*in nsIRequest*/ aRequest,
                     /*in unsigned long*/ aStateFlags,
                     /*in nsresult*/ aStatus)
  {
  },

  onProgressChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in long*/ aCurSelfProgress,
                        /*in long */aMaxSelfProgress,
                        /*in long */aCurTotalProgress,
                        /*in long */aMaxTotalProgress)
  {
  },

  onLocationChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in nsIURI*/ aLocation)
  {
    if (aLocation.spec.indexOf(this._prefix) != 0) {

      try {
        let parentWin = Services.wm.getMostRecentWindow("navigator:browser");
        let newTab = parentWin.gBrowser.addTab(aLocation.spec);
        parentWin.gBrowser.selectedTab = newTab;
      } catch (e) {
        console.log(e);
      }

      try {
        this._browser.goBack();
      } catch (e) {
        console.log(e);
      }
    }
  },

  onStatusChange: function(/*in nsIWebProgress*/ aWebProgress,
                      /*in nsIRequest*/ aRequest,
                      /*in nsresult*/ aStatus,
                      /*in wstring*/ aMessage)
  {
  },

  onSecurityChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in unsigned long*/ aState)
  {
  },
}
