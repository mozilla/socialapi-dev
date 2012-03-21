"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://socialdev/lib/console.js");
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

    let socialpanel = aWindow.document.createElementNS(XUL_NS, "menupopup");
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
      let registry = providerRegistry();
      if (!registry.currentProvider || !registry.currentProvider.active) {
        console.log("no service is active, so not opening the socialbar!")
      }
      else {
        let sidebar = aWindow.social.sidebar;
        if (sidebar.visibility == 'hidden') {
          sidebar.enable();
        }
        else {
          sidebar.visibility = (sidebar.visibility=="open" ? "minimized" : "open");
        }
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
      }
      else {
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

  function renderProviderMenuitem(service, container) {
    let registry = providerRegistry();

    let menuitem = window.document.createElementNS(XUL_NS, "menuitem");
    menuitem.setAttribute("label", service.name);
    menuitem.setAttribute("class", "menuitem-iconic");
    menuitem.setAttribute("image", service.iconURL);
    menuitem.setAttribute("type", "checkbox");
    menuitem.setAttribute("name", "socialprovider");
    if (service == registry.currentProvider) {
      // no need for a click handler if we're selected
      menuitem.setAttribute("checked", true);
    }
    else {
      menuitem.addEventListener("click", function(event) {
        registry.currentProvider = service;
      });
    }
    container.appendChild(menuitem);

    // render notifications...
    for (let i in service.notifications) {
      let aNotif = service.notifications[i];
      container.appendChild(renderNotificationRow(aNotif[0], aNotif[1], aNotif[2]));
    }
  }

  try {
    while (socialpanel.firstChild) socialpanel.removeChild(socialpanel.lastChild);

    // Create top-level items
    let menuitem = window.document.createElementNS(XUL_NS, "menuitem");
    if (window.social.sidebar.visibility == "open") {
      menuitem.setAttribute("label", "Minimize social sidebar");
      menuitem.addEventListener("click", function(event) {
        // open about:social
        window.social.sidebar.visibility = "minimized";
      });
    }
    else {
      menuitem.setAttribute("label", "Show social sidebar");
      menuitem.addEventListener("click", function(event) {
        // open about:social
        window.social.sidebar.visibility = "open";
      });
    }
    socialpanel.appendChild(menuitem);

    menuitem = window.document.createElementNS(XUL_NS, "menuitem");
    if (window.social.sidebar.visibility != "hidden") {
      menuitem.setAttribute("label", "Disable social browsing");
      menuitem.addEventListener("click", function(event) {
        // open about:social
        window.social.sidebar.disable();
      });
    }
    else {
      menuitem.setAttribute("label", "Enable social browsing");
      menuitem.addEventListener("click", function(event) {
        // open about:social
        window.social.sidebar.enable();
      });
    }
    socialpanel.appendChild(menuitem);

    socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));

    // Create network rows...
    providerRegistry().each(function(service) {
      if (service.enabled)
        renderProviderMenuitem(service, socialpanel);
    });

    // Add some demo stuff
    socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));
    menuitem= window.document.createElementNS(XUL_NS, "menuitem");
    menuitem.setAttribute("label", "Fire a demo notification");
    menuitem.addEventListener("click", function(event) {
      // cannot fire a notification from inside an event, setTimeout is our friend
      window.setTimeout(notification.addNotification, 0, {
          "_iconUrl": "http://1.gravatar.com/userimage/13041757/99cac03c3909baf0cd2f2a5e1cf1deed?size=36",
          "_title": "Michael Hanson",
          "_body" : "has demoed a Firefox feature"
        });
    });
    socialpanel.appendChild(menuitem);

    socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));
    menuitem = window.document.createElementNS(XUL_NS, "menuitem");
    menuitem.setAttribute("label", "Preferences");
    menuitem.addEventListener("click", function(event) {
      // open about:social
      window.gBrowser.selectedTab = window.gBrowser.addTab("about:social");
    });
    socialpanel.appendChild(menuitem);

  }
  catch (e) {
    console.log("Error creating socialpopupcontents: " + e);
  }
}
