"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/lib/registry.js");
Cu.import("resource://socialdev/lib/baseWidget.js");

let notification = {};
Cu.import("resource://socialdev/lib/notification.js", notification);

const EXPORTED_SYMBOLS = ["ToolbarButton"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";


function ToolbarButton(aWindow) {
  baseWidget.call(this, aWindow);

  // we need to make our button appear on first install, for now we always
  // ensure that it is in the toolbar, even if the user removes it
  var navbar = aWindow.document.getElementById("nav-bar");
  var newset = navbar.currentSet + ",social-button-container";
  navbar.currentSet = newset;
  navbar.setAttribute("currentset", newset );
  aWindow.document.persist("nav-bar", "currentset");  
}
ToolbarButton.prototype = {
  __proto__: baseWidget.prototype,
  create: function(aWindow) {
  },
  remove: function() {
  },
  onpopupshown: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    var sbrowser = aWindow.document.getElementById("social-status-sidebar-browser");
    sbrowser.style.opacity = 0.3;
  },
  onpopuphidden: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    var sbrowser = aWindow.document.getElementById("social-status-sidebar-browser");
    sbrowser.style.opacity = 1;
  },
  onpopupshowing: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    let socialpanel = aWindow.document.getElementById("social-popup-panel");
    buildSocialPopupContents(aWindow, socialpanel);
  },
  oncommand: function(event) {
    if (event.target.getAttribute("id") != "socialdev-button")
      return;
    let aWindow = event.target.ownerDocument.defaultView;
    let registry = providerRegistry();
    if (!registry.currentProvider || !registry.currentProvider.enabled) {
      Services.console.logStringMessage("no service is enabled, so not opening the socialbar!")
    }
    else {
      let sidebar = aWindow.social.sidebar;
      if (sidebar.visibility == 'hidden') {
        Services.obs.notifyObservers(null, "social-browsing-enabled", null);
      }
      else {
        sidebar.visibility = (sidebar.visibility=="open" ? "minimized" : "open");
      }
    }
  }
}


function buildSocialPopupContents(window, socialpanel)
{
  let registry = providerRegistry();

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

    let menuitem = window.document.createElementNS(XUL_NS, "menuitem");
    menuitem.setAttribute("label", service.name);
    menuitem.setAttribute("class", "menuitem-iconic");
    menuitem.setAttribute("image", service.iconURL);
    menuitem.setAttribute("type", "radio");
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

  let menuitem;
  let disabled = window.social.sidebar.disabled;
  try {
    while (socialpanel.firstChild) socialpanel.removeChild(socialpanel.lastChild);
    // Create top-level items
    if (registry.currentProvider) {
      if (!disabled) {
        menuitem = window.document.createElementNS(XUL_NS, "menuitem");
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
      }

      menuitem = window.document.createElementNS(XUL_NS, "menuitem");
      if (window.social.sidebar.visibility != "hidden") {
        menuitem.setAttribute("label", "Disable social browsing");
        menuitem.addEventListener("click", function(event) {
          // open about:social
          Services.obs.notifyObservers(null, "social-browsing-disabled", null);
        });
      }
      else {
        menuitem.setAttribute("label", "Enable social browsing");
        menuitem.addEventListener("click", function(event) {
          // open about:social
          Services.obs.notifyObservers(null, "social-browsing-enabled", null);
        });
      }
      socialpanel.appendChild(menuitem);

      if (!disabled) {
        socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));
    
        // Create network rows...
        registry.each(function(service) {
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
      }
  
      socialpanel.appendChild(window.document.createElementNS(XUL_NS, "menuseparator"));
    }

    menuitem = window.document.createElementNS(XUL_NS, "menuitem");
    menuitem.setAttribute("label", "Preferences");
    menuitem.addEventListener("click", function(event) {
      // open about:social
      window.gBrowser.selectedTab = window.gBrowser.addTab("about:social");
    });
    socialpanel.appendChild(menuitem);

  }
  catch (e) {
    Cu.reportError("Error creating socialpopupcontents: " + e);
  }
}
