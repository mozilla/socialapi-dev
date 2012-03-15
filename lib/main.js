/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is socialdev.
 *
 * The Initial Developer of the Original Code is The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2012
 * the Initial Developer. All Rights Reserved.
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/listen.js");
Cu.import("resource://socialdev/lib/unload+.js");
Cu.import("resource://socialdev/lib/watchWindows.js");

let notification = {};
let provider = {};
try {
  Cu.import("resource://socialdev/lib/registry.js");
  Cu.import("resource://socialdev/lib/notification.js", notification);
  Cu.import("resource://socialdev/lib/provider.js", provider);
} catch(e) {
  console.log("Import error: " + e);
}

Cu.import("resource://socialdev/lib/chatwindow.js");
Cu.import("resource://socialdev/lib/loadStyles.js");

const EXPORTED_SYMBOLS = ["startup", "shutdown"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const isMac = Services.appinfo.OS == "Darwin";

// This is the the global array of installed services.
// We will need to replace this with an XPCOM Service at some point.
// For now it is statically declared.
let gSocialServices = [];

// we keep a global list of windows that have been
// opened for social services so we can close them
// down at shutdown.
let gServiceWindows = [];

// We maintain a global array of browsers that require
// content injection; the list is automatically pruned
// when a window is closed.
let gSocialBrowsers = [];

function registerBrowserWatch(aBrowser)
{
  mainLog("registering a browser watch");
  gSocialBrowsers.push(aBrowser);
}

function unregisterBrowserWatchList(aBrowserList)
{
  for each (var sbrowser in aBrowserList) {
    let index = gSocialBrowsers.indexOf(sbrowser);
    if (index != -1) {
      gSocialBrowsers.splice(index, 1);
    }
  }
}

function removeServiceWindow(aWindow)
{
  mainLog("removing a service window");
  let index = gServiceWindows.indexOf(aWindow);
  if (index != -1) {
    mainLog("found it; removing " + index);
    gServiceWindows.splice(index, 1);
  }
}

function shutdown(data) {
  for each (var service in gSocialServices) {
    service.shutdown();
  }
  for each (var serviceWindow in gServiceWindows) {
    serviceWindow.close();
  }
  gServiceWindows = [];
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

  // start up service(s)
  gSocialServices = [];

  // per-window initialization for socialdev
  watchWindows(function(window) {
    try {
      // Install the sidebar
      attachSidebar(window, gSocialServices);

      // Always put a new button in the navbar
      attachSocialToolbarButton(window);

      // install "Like" button in the URL bar
      attachLikeButton(window, gSocialServices);

      // XXX - "share" button??

      if (gSocialServices.length> 0) {
        setVisibleService(window, gSocialServices[0]);
      }
      Services.obs.addObserver(function(subject, topic, data) {
        // XXX is this the service we want to show in this sidebar?
        // XXX how do we determine that?
        mainLog("got notification");
        for each (var service in gSocialServices) {
          if (service.name == data) {
            setVisibleService(window, service);
            break;
          }
        }
      }, 'social-service-init-ready', false);

    } catch (e) {
      mainLog("window watcher failure:" + e);
      mainLog(e.stack);

    }
  });

  let registry = manifestRegistry();
  registry.get(function(manifest) {
    let service = new provider.SocialProvider(manifest);
    service.active = true;
    service.init(null,
      function() {
        gSocialServices.push(service);
        Services.obs.notifyObservers(null, "social-service-init-ready", service.name);
    });
  });

  injectController = function(doc, topic, data) {
    try {
      // As written, we check every window for a match with every
      // service, and attach the service to all windows that match.

      // That's not really our design intent - we only want to
      // attach to windows that are rendering in "trusted social browsers"
      // (i.e. sidebars and servicewindows).

      // TODO check whether this is a socialBrowser (e.g. in the gSocialBrowsers list)
      // and don't inject in those cases.
      // TODO better yet just climb up the QI chain to determine if the owner parent
      // has a social browser ID (sidebar or servicewindow)

      for each (var service in gSocialServices) {
        if ((doc.location + "").indexOf(service.URLPrefix) == 0) {

          let targetWindow = doc.defaultView.wrappedJSObject;

          // what window do we create the control object with?
          var tabOpenerFn = function(a) {
            let parentWin = Services.wm.getMostRecentWindow("navigator:browser");
            let newTab = parentWin.gBrowser.addTab(a);
            // XXX check for modifier key and don't select new tab in that case
            parentWin.gBrowser.selectedTab = newTab;
          }

          service.attachToWindow(doc.defaultView/*targetWindow*/,
            tabOpenerFn, createWindow);//XXX pass in a control object for addTab, idle, etc.
          return;
        }
      }
    } catch(e) {
      mainLog("unable to inject for "+doc.location);
      console.log(e);
    }
  };
  Services.obs.addObserver(injectController, 'document-element-inserted', false);
};


function setVisibleService(window, aService)
{
    mainLog("setVisibleService " + aService);
  window.displayedSocialService = aService;

  // retarget the sidebar
  var sbrowser = window.document.getElementById("social-status-sidebar-browser");
  sbrowser.service = aService;
  sbrowser.setAttribute("src", aService.sidebarURL);

  // set up a locationwatcher
  try {
    // Keep a reference to the listener so it doesn't get collected
    sbrowser.watcher = new LocationWatcher(sbrowser.service.URLPrefix, sbrowser);
    sbrowser.addProgressListener(sbrowser.watcher, Ci.nsIWebProgress.NOTIFY_LOCATION);
  } catch (e) {
    mainLog("**** ProgressError: " + e);
  }

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
      sbrowser.open = !sbrowser.open;
      reflowSidebar(window);
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
    // "padding-top:1px;padding-bottom:1px;margin-top:1px;margin-bottom:2px;margin-start-value:6px,margin-end-value:5px"
    // font-family:'lucida grande',tahoma,verdana,arial,sans-serif;font-size:11px");

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

  function renderNetworkSection(service) { // icon, notifications, switcher) {
    let netDiv = window.document.createElementNS(HTML_NS, "div");
    netDiv.setAttribute("class", "social-popup-service-row");

    let leftCol = window.document.createElementNS(HTML_NS, "div");
    leftCol.setAttribute("class", "social-popup-service-row-leftcol");
    // XXX need to get the right border down to the bottom of the entire div, what's the right way to do that?

    let rightCol = window.document.createElementNS(HTML_NS, "div");
    rightCol.setAttribute("class", "social-popup-service-row-rightcol");

    netDiv.appendChild(leftCol);
    netDiv.appendChild(rightCol);

    let netImg = window.document.createElementNS(HTML_NS, "img");
    netImg.setAttribute("class", "social-popup-service-row-icon");
    netImg.setAttribute("src", service.iconURL);
    netImg.setAttribute("width", 16);
    netImg.setAttribute("height", 16);
    leftCol.appendChild(netImg);

    let networkCaption = window.document.createElementNS(HTML_NS, "div");
    // rightCol.setAttribute("style", "");
    networkCaption.appendChild(window.document.createTextNode("Status/configuration goes here..."));
    rightCol.appendChild(networkCaption);

    // render notifications...
    for (let i in service.notifications) {
      let aNotif = service.notifications[i];
      rightCol.appendChild(renderNotificationRow(aNotif[0], aNotif[1], aNotif[2]));
    }

    // turn on/off item
    let activateDiv = window.document.createElementNS(HTML_NS, "div");
    activateDiv.setAttribute("class", "social-popup-service-row-menuitem")
    if (service.active) {
      activateDiv.appendChild(window.document.createTextNode("Turn off " + service.name));
    } else {
      activateDiv.appendChild(window.document.createTextNode("Turn on " + service.name));
    }
    rightCol.appendChild(activateDiv);

    // switcher item
    if (gSocialServices.length > 1) {
      if (service != window.displayedSocialService) {
        let switcherDiv = window.document.createElementNS(HTML_NS, "div");
        switcherDiv.setAttribute("class", "social-popup-service-row-menuitem")
        switcherDiv.appendChild(window.document.createTextNode("Switch to " + service.name));
        rightCol.appendChild(switcherDiv);
      }
    }

    return netDiv;
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
    for each (var service in gSocialServices) {
      socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));
      socialpanel.appendChild(renderNetworkSection(service));
    }

    // Add some demo stuff
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
  let open = sbrowser.open;

  if (open)
    window.document.documentElement.classList.add("social-open");
  else
    window.document.documentElement.classList.remove("social-open");

  let tabs = window.document.getElementById("TabsToolbar");
  let nav = window.document.getElementById('nav-bar');
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

  // start with the sidebar open
  sbrowser.open = true;

  // save to the global list for content injection
  registerBrowserWatch(sbrowser);

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

  // Automatically open (and keep open) the sidebar if minimized when clicked
  vbox.addEventListener("mousedown", function() {
    if (!sbrowser.open) {
      sbrowser.open = true;
      reflowSidebar(window);
    }
  });

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

  // Clean up changes to chrome
  unload(function() {
    vbox.parentNode.removeChild(vbox.previousSibling); // remove splitter
    vbox.parentNode.removeChild(vbox);
    unregisterBrowserWatchList([sbrowser]);
    restoreToolbar();
  }, window);

}

function attachLikeButton(window, services) {
  // According to the spec, we message the service then it responds with a
  // caption and image for the like button.  But we have multiple services,
  // not 1. So just assume the first.
  let service = services[0];
  let likeButton = window.document.createElementNS(XUL_NS, "image");
  likeButton.id = "social-button";
  // disabled until we get told by the service what the message and icon are.
  likeButton.setAttribute("hidden", "true");
  likeButton.className = "social-button";
  /*
  let worker = service.makeWorker(window);
    worker.port.onmessage = function(evt) {
      if (evt.data.topic === 'user-recommend-prompt-response') {
        let data = evt.data.data;
        likeButton.setAttribute("tooltiptext", data.message); // XXX - 'message' not in spec.
        likeButton.setAttribute("src", data.img);
        likeButton.removeAttribute("hidden");
      };
    };
    worker.port.postMessage({topic: "user-recommend-prompt"});
*/


  likeButton.addEventListener("click", function(event) {

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
  urlbarIcons.insertBefore(likeButton, urlbarIcons.firstChild);
  // is it really necessary to remove the button?
  unload(function() {
    urlbarIcons.removeChild(likeButton);
  }, window);
};

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



// Passed to services to allow them to create new windows for themselves.
function createWindow(toURL, name, options, withService, title, readyCallback)
{
  // See if we've already got one...
  for each (var sWindow in gServiceWindows) {
    if (sWindow.service == withService && sWindow.name == name) {
      if (readyCallback) readyCallback();
      return sWindow;
    }
  }

  mainLog("createWindow "+options)
  let opts = {
      features: options,
      name: name,
      url: toURL,
      title:title,

    onClose: function() {
      unregisterBrowserWatchList([aWind.browser]);
      try {
        withService.windowClosing(aWind);
      } catch (e) {}

      removeServiceWindow(aWind);
    },

    onReady: function() {
      try {
        if ((aWind.browser.contentWindow.location.href).indexOf(withService.URLPrefix) != 0) {
          return;
        }
        aWind.browser.service = withService;
        registerBrowserWatch(aWind.browser);
        if (readyCallback) readyCallback();
      } catch(e) {
        mainLog("chat window error: "+e);
      }
    }

  };
  var aWind = new ChatWindow();
  aWind.open(opts);
  aWind.service = withService;
  aWind.name = name;
  gServiceWindows.push(aWind);
  return aWind;
}
