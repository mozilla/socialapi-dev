"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/listen.js");
Cu.import("resource://socialdev/lib/unload+.js");
Cu.import("resource://socialdev/lib/watchWindows.js");
Cu.import("resource://socialdev/lib/registry.js");
Cu.import("resource://socialdev/lib/baseWidget.js");

let notification = {};
Cu.import("resource://socialdev/lib/notification.js", notification);

const EXPORTED_SYMBOLS = ["ToolbarButton"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";


function ToolbarButton(aWindow) {
  baseWidget.call(this, aWindow);
}
ToolbarButton.prototype = {
  __proto__: baseWidget.prototype,
  create: function(aWindow) {
    let socialcontainer = this._widget = aWindow.document.createElementNS(XUL_NS, "toolbaritem");
    socialcontainer.setAttribute("id", "social-button-container");
    socialcontainer.setAttribute("class", "chromeclass-toolbar-additional");
    socialcontainer.setAttribute("removable", "true");
    socialcontainer.setAttribute("title", "Social");

    let socialtoolbarbutton = aWindow.document.createElementNS(XUL_NS, "toolbarbutton");
    socialcontainer.appendChild(socialtoolbarbutton);
    socialtoolbarbutton.setAttribute("id", "social-button");
    socialtoolbarbutton.setAttribute("type", "menu-button");
    socialtoolbarbutton.setAttribute("class", "toolbarbutton-1 chromeclass-toolbar-additional");
    socialtoolbarbutton.setAttribute("removable", "true");
    socialtoolbarbutton.setAttribute("image", "resource://socialdev/data/social.png");
    socialtoolbarbutton.setAttribute("tooltiptext", "Social Browsing");

    let socialpanel = aWindow.document.createElementNS(XUL_NS, "panel");
    socialpanel.setAttribute("id", "social-popup-panel");
    socialtoolbarbutton.appendChild(socialpanel);

    socialpanel.addEventListener("popupshown", function(event) {
      var sbrowser = aWindow.document.getElementById("social-status-sidebar-browser");
      sbrowser.style.opacity = 0.3;
    });
    socialpanel.addEventListener("popuphidden", function(event) {
      var sbrowser = aWindow.document.getElementById("social-status-sidebar-browser");
      sbrowser.style.opacity = 1;
    });
    socialpanel.addEventListener("popupshowing", function(event) {
      buildSocialPopupContents(aWindow, socialpanel);
    });

    socialtoolbarbutton.addEventListener("command", function(event) {
      if (event.target != socialtoolbarbutton)
        return;
      var sbrowser = aWindow.document.getElementById("social-status-sidebar-browser");
      let registry = providerRegistry();
      if (!registry.currentProvider || !registry.currentProvider.active) {
        mainLog("no service is active, so not opening the socialbar!")
      } else {
        sbrowser.visibility = (sbrowser.visibility=="open" ? "minimized" : "open");
      }
    });

    // add as right-most item
    var navBar = aWindow.document.getElementById('nav-bar');
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
  },
  remove: function() {
    let window = this._widget.ownerDocument.defaultView;
    var navBar = window.document.getElementById('nav-bar');
    if (navBar) {
      navBar.removeChild(this._widget);
    }
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
        service.deactivate();
      });
    } else {
      activateItem.setAttribute("label", "Turn on " + service.name);
      activateItem.addEventListener("click", function(event) {
        service.activate();
      });
    }
    container.appendChild(activateItem);

    // render notifications...
    for (let i in service.notifications) {
      let aNotif = service.notifications[i];
      container.appendChild(renderNotificationRow(aNotif[0], aNotif[1], aNotif[2]));
    }

    // switcher item
    let registry = providerRegistry();
    if (service != registry.currentProvider) {
      let switcherItem = window.document.createElementNS(XUL_NS, "menuitem");
      switcherItem.setAttribute("label", "Switch sidebar to " + service.name);
      switcherItem.addEventListener("click", function(event) {
        registry.currentProvider = service;
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
