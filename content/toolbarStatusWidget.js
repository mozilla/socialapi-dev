"use strict";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/modules/baseWidget.js");

function SocialToolbarStatusArea() {
  baseWidget.call(this, window);

  // we need to make our button appear on first install, for now we always
  // ensure that it is in the toolbar, even if the user removes it
  var navbar = window.document.getElementById("nav-bar");
  var newset = navbar.currentSet + ",social-status-area-container";
  navbar.currentSet = newset;
  navbar.setAttribute("currentset", newset );
  window.document.persist("nav-bar", "currentset");
  
  Services.obs.addObserver(this, 'social-browsing-ambient-notification-changed', false);
}

SocialToolbarStatusArea.prototype = {
  __proto__: baseWidget.prototype,

  create: function(aWindow) {
  },

  remove: function() {
  },

  setProvider: function(service) {
    this.renderAmbientNotification();
  },

  renderAmbientNotification: function() {
    function createNotificationIcon(icon) {
        var iconContainer = window.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        iconContainer.setAttribute("class", "social-notification-icon-container");

        var iconBackground = window.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        iconBackground.setAttribute("class", "social-notification-icon-background-highlight");

        var iconImage = window.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        iconImage.setAttribute("class", "social-notification-icon-image");
        iconImage.style.background = icon.background;
        
        var iconCounter = window.document.createElementNS(XUL_NS, "div");        
        iconCounter.setAttribute("class", "social-notification-icon-counter");
        
        if (icon.counter) {
          iconCounter.appendChild(window.document.createTextNode(icon.counter));
        } else {
          iconCounter.style.display = "none";
        }

        iconContainer.appendChild(iconBackground);
        iconContainer.appendChild(iconImage);
        iconContainer.appendChild(iconCounter);  
        iconBox.appendChild(iconContainer);

        iconContainer.addEventListener("click", function(e) {
          var panel = window.document.getElementById("social-notification-panel");
          var notifBrowser = window.document.getElementById("social-notification-browser");
          
          var resizer = function() {
            var body = notifBrowser.contentDocument.getElementById("notif");
            notifBrowser.width = body.clientWidth;
            notifBrowser.height = body.clientHeight;
            panel.width = body.clientWidth;
            panel.height = body.clientHeight;              
            notifBrowser.removeEventListener("DOMContentLoaded", resizer);
          }
          notifBrowser.addEventListener("DOMContentLoaded", resizer, false);
          notifBrowser.setAttribute("src", icon.contentPanel);
          panel.openPopup(iconContainer, "after_start",0,0,false, false);

        }, false);
    }


    try {
      dump("Rendering Ambient Notification region\n");
    // create some elements...
    var XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

    // XXX is window safe to use here?
    var container = window.document.getElementById("social-status-content-container");
      //social-status-area-container");
    while (container.firstChild) container.removeChild(container.firstChild);

    let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                            .getService(Ci.mozISocialRegistry);
    if (!registry.currentProvider || !registry.currentProvider.enabled) {
      Services.console.logStringMessage("no service is enabled, so not rendering status area");
      return;
    }

    var image = window.document.getElementById("social-statusarea-service-image");
    image.setAttribute("src", registry.currentProvider.iconURL);

   /* if (registry.currentProvider.ambientNotificationBackground) {
      container.style.background = registry.currentProvider.ambientNotificationBackground;
    } else {*/
      //container.style.backgroundColor = "rgb(152,152,152)";
    //}
    var iconStack = window.document.createElementNS(XUL_NS, "stack");

    var iconBox = window.document.createElementNS(XUL_NS, "hbox");
    iconBox.setAttribute("flex", 1);
    if (registry.currentProvider.ambientNotificationIcons) {
      for each (var icon in registry.currentProvider.ambientNotificationIcons)
      {
        createNotificationIcon(icon);   
      }
      iconBox.style.minWidth = (26 * registry.currentProvider.ambientNotificationIcons.length) + "px";
    }

    iconStack.appendChild(iconBox);
    container.appendChild(iconStack);

    var portraitBox = window.document.createElementNS(XUL_NS, "div");
    portraitBox.setAttribute("class", "social-portrait-box");
    portraitBox.align = "start";
    container.insertBefore(portraitBox, container.firstChild);

    if (registry.currentProvider.ambientNotificationPortrait) {

//      var portrait = window.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      var portrait = window.document.createElementNS(XUL_NS, "image");
      portrait.setAttribute("class", "social-portrait-image");
      portrait.setAttribute("src", registry.currentProvider.ambientNotificationPortrait);
      // portrait on left:
      portraitBox.appendChild(portrait);

      // portrait on right:
      // container.appendChild(portrait);
    }

    } catch (e) {
      dump("\n\n\n" + e + "\n\n\n");
    } 
  },

  onpopupshown: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    if (aWindow.social.sidebar && aWindow.social.sidebar.browser) {
      aWindow.social.sidebar.browser.style.opacity = 0.3;
    }
  },
  onpopuphidden: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    if (aWindow.social.sidebar && aWindow.social.sidebar.browser) {
      aWindow.social.sidebar.browser.style.opacity = 1;
    }
  },
  onpopupshowing: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    let popup = aWindow.document.getElementById("social-statusarea-popup");
    buildSocialPopupContents(aWindow, popup);
  },

  disable: function() {
    // reset the image to the default.
    var image = window.document.getElementById("social-statusarea-service-image");
    image.setAttribute("src", "chrome://socialdev/skin/social.png");
  },

  ambientNotificationChanged: function() {
    this.renderAmbientNotification();
  }
}


const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

function buildSocialPopupContents(window, socialpanel)
{
  let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                          .getService(Ci.mozISocialRegistry);

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

  function renderProviderMenuitem(service, container, before) {

    let menuitem = window.document.createElementNS(XUL_NS, "menuitem");

    let itemText = service.name;
    let notificationCount = 0;
    if (service.ambientNotificationIcons) {
      for (var i in service.ambientNotificationIcons) {
        if (service.ambientNotificationIcons[i].counter) {
          notificationCount += service.ambientNotificationIcons[i].counter;
        }
      }
      if (notificationCount)
        itemText += " (" + notificationCount + " notifications)";
    }
    menuitem.setAttribute("label", itemText);

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
    container.insertBefore(menuitem, before);
  }

  try {
    let menuitem;
    let disabled = !window.social.enabled;
    let providerSep = document.getElementById('social-statusarea-providers-separator');
    while (providerSep.previousSibling) {
      socialpanel.removeChild(providerSep.previousSibling);
    }

    // if we are disabled we don't want the list of providers nor the separators
    if (disabled) {
      providerSep.setAttribute("hidden", "true");
    } else {
      providerSep.removeAttribute("hidden");
      // Create top-level items
      registry.each(function(service) {
        if (service.enabled)
          renderProviderMenuitem(service, socialpanel, providerSep);
      });
    }
  }
  catch (e) {
    Cu.reportError("Error creating socialpopupcontents: " + e);
  }
}