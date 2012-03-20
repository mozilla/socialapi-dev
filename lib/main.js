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
  watchWindows(function(window) {
    try {
      // only attach the sidebar and toolbar stuff if this is not a popup window.
      // according to http://mxr.mozilla.org/mozilla-central/source/browser/base/content/browser.js#1360,
      // the simple check is if the toolbar is visible or not...
      if (!window.toolbar.visible) {
        return;
      }
      // Install the sidebar
      attachSidebar(window);

      // Always put a new button in the navbar
      attachSocialToolbarButton(window);

      // Helper function, called when a service is ready to go.
      var perWindowServiceReady = function(service) {
        mainLog("service " + service.name + " is ready - initializing it");
        // install "Recommend" button in the URL bar
        attachRecommendButton(window, service);
        // XXX - "share" button??

        setVisibleService(window, service);
      };

      // If the user's newWindow service is ready to go, set it up right away.
      if (registry.currentProvider && registry.currentProvider.active) {
        perWindowServiceReady(registry.currentProvider);
      }
      // If it's not ready to go, take it when it's ready
      Services.obs.addObserver(function(subject, topic, data) {
        mainLog("Observed social-service-init-ready: " + data);
        let service = registry.getNamed(data);
        if (service == registry.currentProvider) {
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


function setVisibleService(window, aService)
{
  mainLog("setVisibleService " + aService.name);

  if (!aService.active) return;// sanity check
  providerRegistry().currentProvider = aService;
  window.displayedSocialService = aService;

  // retarget the sidebar
  var sbrowser = window.document.getElementById("social-status-sidebar-browser");
  sbrowser.service = aService;
  sbrowser.contentWindow.location = aService.sidebarURL;
  sbrowser.visibility = sbrowser._open ? "open" : "minimized";

  // set up a locationwatcher
  try {
    // Keep a reference to the listener so it doesn't get collected
    sbrowser.watcher = new LocationWatcher(sbrowser.service.URLPrefix, sbrowser);
    sbrowser.addProgressListener(sbrowser.watcher, Ci.nsIWebProgress.NOTIFY_LOCATION);
  } catch (e) {
    mainLog("**** ProgressError: " + e);
  }
}

function getServiceNamed(name) {
  return providerRegistry().getNamed(name);
}

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
          sbrowser.removeProgressListener(sbrowser.watcher);
          sbrowser.watcher = null;
          sbrowser.contentWindow.location = "about:blank";
          sbrowser.visibility = "hidden";
          removeRecommendButton(window);
          reflowSidebar(window);
        }
      }
    }

    // shut down the worker
    aService.shutdown();
    aService.active = false;
    Services.obs.notifyObservers(null, "social-service-shutdown", aService.name);
  } catch (e) {
    mainLog("failed to deactivate service: " + e);
  }
}

function activateService(aService)
{
  mainLog("Activating social service " + aService.name);

  aService.active = true;
  aService.init(null,
    function() {
      Services.obs.notifyObservers(null, "social-service-init-ready", aService.name);
  });
}

/** Create the toolbar button and attach it to the navbar */
function attachSocialToolbarButton(window)
{
  try {
    let socialcontainer = window.document.createElementNS(XUL_NS, "toolbaritem");
    socialcontainer.setAttribute("id", "social-button-container");
    socialcontainer.setAttribute("class", "chromeclass-toolbar-additional");
    socialcontainer.setAttribute("removable", "true");
    socialcontainer.setAttribute("title", "Social");

    let socialtoolbarbutton = window.document.createElementNS(XUL_NS, "toolbarbutton");
    socialcontainer.appendChild(socialtoolbarbutton);
    socialtoolbarbutton.setAttribute("id", "social-button");
    socialtoolbarbutton.setAttribute("type", "menu-button");
    socialtoolbarbutton.setAttribute("class", "toolbarbutton-1 chromeclass-toolbar-additional");
    socialtoolbarbutton.setAttribute("removable", "true");
    socialtoolbarbutton.setAttribute("image", "resource://socialdev/data/social.png");
    socialtoolbarbutton.setAttribute("tooltiptext", "Social Browsing");

    let socialpanel = window.document.createElementNS(XUL_NS, "panel");
    socialpanel.setAttribute("id", "social-popup-panel");
    socialtoolbarbutton.appendChild(socialpanel);

    socialpanel.addEventListener("popupshown", function(event) {
      var sbrowser = window.document.getElementById("social-status-sidebar-browser");
      sbrowser.style.opacity = 0.3;
    });
    socialpanel.addEventListener("popuphidden", function(event) {
      var sbrowser = window.document.getElementById("social-status-sidebar-browser");
      sbrowser.style.opacity = 1;
    });
    socialpanel.addEventListener("popupshowing", function(event) {
      buildSocialPopupContents(window, socialpanel);
    });

    socialtoolbarbutton.addEventListener("command", function(event) {
      if (event.target != socialtoolbarbutton)
        return;
      var sbrowser = window.document.getElementById("social-status-sidebar-browser");
      let registry = providerRegistry();
      if (!registry.currentProvider || !registry.currentProvider.active) {
        mainLog("no service is active, so not opening the socialbar!")
      } else {
        sbrowser.visibility = (sbrowser.visibility=="open" ? "minimized" : "open");
      }
    });

    // add as right-most item
    var navBar = window.document.getElementById('nav-bar');
    if (navBar) {
      var aChild= navBar.firstChild;
      var lastToolbarButton;

      while (aChild) {
        if (aChild.tagName == "toolbarbutton" || aChild.tagName == "toolbaritem") {
          lastToolbarButton = aChild;
        }
        aChild = aChild.nextSibling;
      }
      if (lastToolbarButton.nextSibling) {
        navBar.insertBefore(socialcontainer, lastToolbarButton.nextSibling);
      } else {
        navBar.appendChild(socialcontainer);
      }
    }

    var removeToolbarButton = function() {
      if (navBar) {
        navBar.removeChild(socialcontainer);
      }
    }

    // Clean up changes to chrome
    unload(removeToolbarButton, window);

  } catch (e) {
    console.log(e);
  }
}


function buildSocialPopupContents(window, socialpanel)
{
  function renderNotificationRow(img, title, text) {
    let row = window.document.createElementNS(HTML_NS, "div");
    row.setAttribute("style", "clear:all;cursor:pointer;margin-left:8px;height:32px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:-moz-system-font;border-right:");
    
    let imgElem = window.document.createElementNS(HTML_NS, "img");
    imgElem.setAttribute("src", img);
    imgElem.setAttribute("style", "width:28px;height:28px;margin-right:8px;float:left");

    let titleElem = window.document.createElementNS(HTML_NS, "span");
    titleElem.appendChild(window.document.createTextNode(title));
    titleElem.setAttribute("style", "font-weight:bold");

    let textElem = window.document.createElementNS(HTML_NS, "span");
    textElem.appendChild(window.document.createTextNode(((text.length > 0 && text[0] != ' ') ? " " : "")+ text));

    row.appendChild(imgElem);
    row.appendChild(titleElem);
    row.appendChild(textElem);
    return row;
  }

  function renderNetworkSection(service, container) {

    // Check version history for older version of this using stacked divs;
    // for now, just use menuitems to make it simple.
    let activateItem = window.document.createElementNS(XUL_NS, "menuitem");
    activateItem.setAttribute("label", "Turn off social browsing");
    activateItem.setAttribute("class", "menuitem-iconic");
    activateItem.image= service.iconURL; ///XX this doesn't work, and I can't figure out why.
    if (service.active) {
      activateItem.setAttribute("label", "Turn off " + service.name);
      activateItem.addEventListener("click", function(event) {
        deactivateService(service);
      });
    } else {
      activateItem.setAttribute("label", "Turn on " + service.name);
      activateItem.addEventListener("click", function(event) {
        activateService(service);
      });
    }
    container.appendChild(activateItem);

    // render notifications...
    for (let i in service.notifications) {
      let aNotif = service.notifications[i];
      container.appendChild(renderNotificationRow(aNotif[0], aNotif[1], aNotif[2]));
    }

    // switcher item
    if (service != providerRegistry().currentProvider) {
      let switcherItem = window.document.createElementNS(XUL_NS, "menuitem");
      switcherItem.setAttribute("label", "Switch sidebar to " + service.name);
      switcherItem.addEventListener("click", function(event) {
        setVisibleService(window, service);
      });
      container.appendChild(switcherItem);
    }
  }

  try {
    while (socialpanel.firstChild) socialpanel.removeChild(socialpanel.lastChild);

    // Create top-level items
    let item1 = window.document.createElementNS(XUL_NS, "menuitem");
    item1.setAttribute("label", "Minimize social sidebar");
    socialpanel.appendChild(item1);
    let item2 = window.document.createElementNS(XUL_NS, "menuitem");
    item2.setAttribute("label", "Turn off social browsing");
    socialpanel.appendChild(item2);

    // Create network rows...
    providerRegistry().each(function(service) {
      socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));
      renderNetworkSection(service, socialpanel);
    });

    // Add some demo stuff
    socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));
    let item3 = window.document.createElementNS(XUL_NS, "menuitem");
    item3.setAttribute("label", "Fire a demo notification");
    socialpanel.appendChild(item3);
    item3.addEventListener("click", function(event) {
      notification.addNotification( {
          "_iconUrl": "http://1.gravatar.com/userimage/13041757/99cac03c3909baf0cd2f2a5e1cf1deed?size=36",
          "_title": "Michael Hanson",
          "_body" : "has demoed a Firefox feature"
        });
    });

  } catch (e) {
    console.log("Error creating socialpopupcontents: " + e);
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

function attachRecommendButton(window, service) {
  
  if (!service.active) return;// sanity check

  // We message the service then it responds with a caption and image for
  // the recommend button.
  let recommendButton = window.document.createElementNS(XUL_NS, "image");
  recommendButton.id = "social-button";
  // disabled until we get told by the service what the message and icon are.
  recommendButton.setAttribute("hidden", "true");
  recommendButton.className = "social-button";
  let worker = service.makeWorker(window);
    worker.port.onmessage = function(evt) {
      if (evt.data.topic === 'user-recommend-prompt-response') {
        let data = evt.data.data;
        recommendButton.setAttribute("tooltiptext", data.message); // XXX - 'message' not in spec.
        recommendButton.setAttribute("src", data.img);
        recommendButton.removeAttribute("hidden");
      };
    };
    worker.port.postMessage({topic: "user-recommend-prompt"});

  recommendButton.addEventListener("click", function(event) {

    // note that we probably want something like fx-share's getCanonicalURL
    // which will look through <link rel=.../> tags etc.  And possibly even
    // like getShortURL, which will look for a canonical short URL.
    // later...
    // spec calls for the hash portion to be removed...
    let url = window.gBrowser.currentURI.cloneIgnoringRef().spec;
    mainLog("we like", url);
    worker.port.postMessage({topic: "user-recommend",
                             data: {
                              url: url}
                            });
  }, false);
  let urlbarIcons = window.document.getElementById("urlbar-icons");
  if (urlbarIcons) {
    urlbarIcons.insertBefore(recommendButton, urlbarIcons.firstChild);
    // is it really necessary to remove the button?
    unload(function() {
      urlbarIcons.removeChild(recommendButton);
    }, window);
  } else {
    mainLog("can't locate the urlbar icons; nowhere to put the 'like' button");
  }
};

function removeRecommendButton(window) {
  let recommendButton = window.document.getElementById("social-button");
  if (recommendButton) {
    recommendButton.parentNode.removeChild(recommendButton);
  }
  // is the worker going to be GCed properly?
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
