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
    try {
      dump("Rendering Ambient Notification region\n");
    // create some elements...
    var XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

    // XXX is window safe to use here?
    var container = window.document.getElementById("social-status-area-container");
    while (container.firstChild) container.removeChild(container.firstChild);

    let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                            .getService(Ci.mozISocialRegistry);
    if (!registry.currentProvider || !registry.currentProvider.enabled) {
      Services.console.logStringMessage("no service is enabled, so not rendering status area");
      return;
    }

    if (registry.currentProvider.ambientNotificationBackground) {
      container.style.background = registry.currentProvider.ambientNotificationBackground;
    } else {
      container.style.backgroundColor = "rgb(152,152,152)";
    }

    // fiddly height adjustments.  There must be a CSS way to do this.
    container.style.width="140px";
    container.style.height="38px";//container.parentNode.clientHeight + "px";//"27px";
    //dump("the container's parent node's paddingTop is " + container.parentNode.style.paddingTop + "\n");
    container.style.paddingTop="6px";
    container.style.paddingLeft="4px";
    container.style.marginTop="-16px";
    container.style.marginBottom="-16px";
    container.style.marginRight="-4px";
    
    var iconBox = window.document.createElementNS(XUL_NS, "hbox");
    iconBox.setAttribute("flex", 1);
    for each (var icon in registry.currentProvider.ambientNotificationIcons)
    {
        var iconContainer = window.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        iconContainer.style.cursor = "pointer";
        iconContainer.style.height = "27px";
        iconContainer.style.width = "24px";
        iconContainer.style.position = "relative";
        iconContainer.style.marginTop = "-1px";
        //iconContainer.style.border = "1px solid rgb(59,89,152)";
                
        var iconBackground = window.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        iconBackground.setAttribute("class", "social-notification-icon-background-highlight");

        var iconImage = window.document.createElementNS("http://www.w3.org/1999/xhtml", "div");
        iconImage.style.background = icon.background;
        iconImage.style.width = "24px";
        iconImage.style.height = "31px";
        
        var iconCounter = window.document.createElementNS(XUL_NS, "div");        
        iconCounter.style.backgroundColor = "rgb(240,61,37)";
        iconCounter.style.border = "1px solid rgb(216,55,34)";
        iconCounter.style.boxShadow = "0px 1px 0px rgba(0,39,121,0.77)";
        iconCounter.style.paddingRight = "1px";
        iconCounter.style.paddingLeft = "1px";
        iconCounter.style.color = "white";
        iconCounter.style.fontSize = "9px";
        iconCounter.style.fontWeight = "bold";
        iconCounter.style.position= "absolute";
        iconCounter.style.right= "-3px";
        iconCounter.style.top= "-1px";
        iconCounter.style.zIndex= "1";
        iconCounter.style.textAlign= "center";
        iconCounter.style.display = "none";
        
        //iconCounter.style.display = "none";
        //iconCounter.appendChild(window.document.createTextNode("1"));
            
        iconContainer.appendChild(iconBackground);
        iconContainer.appendChild(iconImage);
        iconContainer.appendChild(iconCounter);  
        iconBox.appendChild(iconContainer);
    }
    container.appendChild(iconBox);

    if (registry.currentProvider.ambientNotificationPortrait) {
      var portrait = window.document.createElementNS(XUL_NS, "img");
      portrait.style.backgroundImage = "url('" + registry.currentProvider.ambientNotificationPortrait + "')"; 
      portrait.style.backgroundSize = "cover";
      portrait.style.marginRight = "8px";
      portrait.style.marginTop = "2px";
      portrait.style.marginBottom = "2px";
      portrait.style.border = "1px solid rgb(41,74,143)";
      portrait.style.height = "24px";// this is ignored.  why?
      portrait.style.width = "24px";
      container.appendChild(portrait);
    }

    } catch (e) {
      dump("\n\n\n" + e + "\n\n\n");
    } 
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
    //let socialpanel = aWindow.document.getElementById("social-toolbar-menu");
    //buildSocialPopupContents(aWindow, socialpanel);
  },
  onToggleEnabled: function() {
    var str = document.getElementById("socialdev-strings");
    if (window.social.sidebar.visibility != "hidden") {
      Services.obs.notifyObservers(null, "social-browsing-disabled", null);
      document.getElementById('social-socialbrowsing-menu').
        setAttribute('label', str.getString("browserEnable.label"));
    }
    else {
      Services.obs.notifyObservers(null, "social-browsing-enabled", null);
      document.getElementById('social-socialbrowsing-menu').
        setAttribute('label', str.getString("browserDisable.label"));
    }
  },
  onToggleVisible: function() {
    var str = document.getElementById("socialdev-strings");
    let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                            .getService(Ci.mozISocialRegistry);
    if (!registry.currentProvider || !registry.currentProvider.enabled) {
      Services.console.logStringMessage("no service is enabled, so not opening the socialbar!")
    }
    else {
      let sidebar = window.social.sidebar;
      if (sidebar.visibility == 'hidden') {
        Services.obs.notifyObservers(null, "social-browsing-enabled", null);
        document.getElementById('social-socialbrowsing-menu').
          setAttribute('label', str.getString("browserDisable.label"));
      }
      else {
        sidebar.visibility = (sidebar.visibility=="open" ? "minimized" : "open");
        let label = (sidebar.visibility == "open" ? "minimizeSidebar.label" : "showSidebar.label")
        document.getElementById('social-socialtoolbar-menu').
          setAttribute('label', str.getString(label));
      }
    }
  },
  
  ambientNotificationChanged: function() {
    this.renderAmbientNotification();
  }
}


