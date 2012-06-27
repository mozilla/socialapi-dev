"use strict";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialapi/modules/baseWidget.js");

Cu.import("resource://socialapi/modules/ProviderRegistry.jsm");



const HTML_NS = "http://www.w3.org/1999/xhtml";

// onpopupshowing logic from arrow panel xbl bindings
function panelOnPopupShowing(window) {
  var container = window.document.getElementById("social-statusarea-popup");
  var panel = container;
  var arrowbox = window.document.getElementById("social-panel-arrowbox");
  var arrow = window.document.getElementById("social-panel-arrow");

  var anchor = panel.anchorNode;
  if (!anchor) {
    arrow.hidden = true;
    return;
  }

  // Returns whether the first float is smaller than the second float or
  // equals to it in a range of epsilon.
  function smallerTo(aFloat1, aFloat2, aEpsilon)
  {
    return aFloat1 <= (aFloat2 + aEpsilon);
  }

  let popupRect = panel.getBoundingClientRect();
  let popupLeft = window.mozInnerScreenX + popupRect.left;
  let popupTop = window.mozInnerScreenY + popupRect.top;
  let popupRight = popupLeft + popupRect.width;
  let popupBottom = popupTop + popupRect.height;

  let anchorRect = anchor.getBoundingClientRect();
  let anchorLeft = anchor.ownerDocument.defaultView.mozInnerScreenX + anchorRect.left;
  let anchorTop = anchor.ownerDocument.defaultView.mozInnerScreenY + anchorRect.top;
  let anchorRight = anchorLeft + anchorRect.width;
  let anchorBottom = anchorTop + anchorRect.height;

  try {
    let anchorWindow = anchor.ownerDocument.defaultView;
    if (anchorWindow != window) {
      let utils = anchorWindow.QueryInterface(Components.interfaces.nsIInterfaceRequestor).
                               getInterface(Components.interfaces.nsIDOMWindowUtils);
      let spp = utils.screenPixelsPerCSSPixel;
      anchorLeft *= spp;
      anchorRight *= spp;
      anchorTop *= spp;
      anchorBottom *= spp;
    }
  } catch(ex) { }

  let pack = smallerTo(popupLeft, anchorLeft, 26) && smallerTo(popupRight, anchorRight, 26) ? "end" : "start";
  arrowbox.setAttribute("pack", pack);
}


function SocialToolbarStatusArea() {
  baseWidget.call(this, window);

  // we need to make our button appear on first install, for now we always
  // ensure that it is in the toolbar, even if the user removes it
  var navbar = window.document.getElementById("nav-bar");
  var newset = navbar.currentSet + ",social-statusarea-container";
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
    this.debugLog("Setting active service provider to " + service.name);
    this.renderAmbientNotification();
  },

  showAmbientPopup: function(iconImage) {
    var panel = window.document.getElementById("social-notification-panel");
    var notifBrowser = window.document.getElementById("social-notification-browser");
    notifBrowser.service = registry().currentProvider;
    let mutationObserver;

    var sizeToContent = function () {
      let doc = notifBrowser.contentDocument;
      let wrapper = doc && doc.getElementById('notif');
      if (!wrapper) {
        return;
      }
      let h = wrapper.scrollHeight > 0 ? wrapper.scrollHeight : 300;
      notifBrowser.style.width = wrapper.scrollWidth + "px";
      notifBrowser.style.height = h + "px";
    }

    notifBrowser.addEventListener("DOMContentLoaded", function onload() {
      notifBrowser.removeEventListener("DOMContentLoaded", onload);
      let body = notifBrowser.contentDocument.getElementById("notif");
      // We setup a mutation observer on the 'notif' element.  When we
      // get a notification we resize the panel.
      // XXX - drop this check one we only work in FF versions we know have it
      let mo = notifBrowser.contentWindow.MutationObserver || notifBrowser.contentWindow.MozMutationObserver;
      if (mo) {
        mutationObserver = new mo(function(mutations) {
          sizeToContent();
        });
        // configuration of the observer - we want everything that could
        // cause the size to change.
        let config = {attributes: true, childList: true, characterData: true}
        mutationObserver.observe(body, config);
      }
      sizeToContent();
    }, false);
    panel.addEventListener("popuphiding", function onpopuphiding() {
      panel.removeEventListener("popuphiding", onpopuphiding);
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
      document.getElementById("social-toolbar").removeAttribute("open");
    }, false);

    notifBrowser.setAttribute("src", iconImage.getAttribute("contentPanel"));
    panel.openPopup(iconImage, "bottomcenter topleft",0,0,false, false);
    document.getElementById("social-toolbar").setAttribute("open", "true");
  },

  renderAmbientNotification: function() {
    var self = this;
    try {
      // create some elements...
      var container = window.document.getElementById("social-toolbar-button");
      // if container is null, it is not in the toolbar
      if (!container)
        return;

      let currentProvider = registry().currentProvider;
      if (!currentProvider || !currentProvider.enabled) {
        this.debugLog("no service is enabled, so not rendering status area");
        return;
      }
      this.debugLog("Rendering toolbar status are; current provider is " + currentProvider.origin);
      if (window.social.enabled) {
        var image = window.document.getElementById("social-statusarea-service-image");
        image.setAttribute("src", currentProvider.iconURL);
      }

      var iconBox = window.document.getElementById("social-statis-iconbox");

      var ambientNotificationCount = 0;
      let iconNames = currentProvider.ambientNotificationIcons ? Object.keys(currentProvider.ambientNotificationIcons) : [];
      for (var i=0; i < iconBox.childNodes.length; i++) {
        let iconContainer = iconBox.childNodes[i];
        if (iconNames.length-1 < i) {
          iconContainer.setAttribute("collapsed", "true");
          continue;
        } else {
          iconContainer.removeAttribute("collapsed");
        }
        let icon = currentProvider.ambientNotificationIcons[iconNames[i]];
        let iconImage = iconContainer.firstChild;
        let iconCounter = iconImage.nextSibling;

        iconImage.setAttribute("contentPanel", icon.contentPanel);
        let imagesrc;
        try {
          imagesrc = /url\((['"]?)(.*)(\1)\)/.exec(icon.background)[2];
        } catch(e) {
          imagesrc = icon.background;
        }
        iconImage.setAttribute("src", imagesrc);

        if (icon.counter) {
          if (iconCounter.firstChild)
            iconCounter.removeChild(iconCounter.firstChild);
          iconCounter.appendChild(window.document.createTextNode(icon.counter));
          iconCounter.removeAttribute("collapsed");
        } else {
          iconCounter.setAttribute("collapsed", "true");
        }
      }

      let userPortrait = document.getElementById("social-statusarea-popup-current-user-portrait")
      if (currentProvider.ambientNotificationPortrait) {
        userPortrait.setAttribute("src", currentProvider.ambientNotificationPortrait);
      } else {
        userPortrait.setAttribute("src", "chrome://socialapi/skin/social.png");
      }

      let userNameBtn = document.getElementById("social-statusarea-username")
      let userName = currentProvider.ambientNotificationUserName ? currentProvider.ambientNotificationUserName : "Current User";
      if (userNameBtn.firstChild)
        userNameBtn.removeChild(userNameBtn.firstChild);
      userNameBtn.appendChild(window.document.createTextNode(userName));

    } catch (e) {
      Cu.reportError(e);
    }
  },

  showPopup: function(event) {
    let btn = document.getElementById('social-statusarea-service-image');
    let panel = document.getElementById("social-statusarea-popup");
    panel.openPopup(btn, "bottomcenter topleft", 0, 0, false, false);
    document.getElementById("social-toolbar").setAttribute("open", "true");
  },

  onpopupshown: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    if (aWindow.social.sidebar && aWindow.social.sidebar.browser) {
      aWindow.social.sidebar.browser.setAttribute("toolbar-popup-visible", "true");
    }
  },
  onpopuphidden: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    if (aWindow.social.sidebar && aWindow.social.sidebar.browser) {
      aWindow.social.sidebar.browser.removeAttribute("toolbar-popup-visible");
    }
    document.getElementById("social-toolbar").removeAttribute("open");
  },
  onpopupshowing: function(event) {
    let aWindow = event.target.ownerDocument.defaultView;
    let popup = aWindow.document.getElementById("social-statusarea-popup");
    buildSocialPopupContents(aWindow, popup);
    try {
      panelOnPopupShowing(aWindow);
    } catch(e) {
      dump(e+"\n");
    }
  },

  disable: function() {
    // reset the image to the default.
    var image = window.document.getElementById("social-statusarea-service-image");
    image.setAttribute("src", "chrome://socialapi/skin/social.png");
  },

  ambientNotificationChanged: function() {
    this.renderAmbientNotification();
  }
}

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

function buildSocialPopupContents(window, socialpanel)
{
  let preg = registry();

  function renderProviderMenuitem(service, container) {

    let menuitem = window.document.createElementNS(XUL_NS, "menuitem");
    menuitem.setAttribute("class", "menuitem-iconic");

    let itemText = service.name;

    /* add "(X notifications)"?
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
    */

    menuitem.setAttribute("image", service.iconURL);
    menuitem.setAttribute("label", itemText);

    if (service == preg.currentProvider) {
      // no need for a click handler if we're selected
      //menuitem.classList.add("social-statusarea-provider-selected");
    }
    else {
      menuitem.addEventListener("click", function(event) {
        preg.currentProvider = service;
      });
    }
    container.appendChild(menuitem);//insertBefore(menuitem, before);
  }

  // Put the list of providers in a submenu:
  let subMenu = window.document.getElementById("social-provider-menupopup")
  while (subMenu.firstChild) subMenu.removeChild(subMenu.firstChild);
  preg.each(function(service) {
    if (service.enabled) {
      renderProviderMenuitem(service, subMenu);
    }
  });
}
