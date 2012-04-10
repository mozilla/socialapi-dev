"use strict";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/modules/baseWidget.js");



function SocialSidebar() {
  this._prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
  baseWidget.call(this, window);
  
  // watch for when browser disables chrome in tabs, and hide the social sidebar
  let _visibilityBeforeAutoHide = this.visibility;
  document.addEventListener('DOMAttrModified', function(e) {
    if (e.target == document.documentElement && e.attrName == "disablechrome") {
      if (e.newValue) {
        _visibilityBeforeAutoHide = this.visibility;
        this.visibility = 'hidden';
      }
      else
        this.visibility = _visibilityBeforeAutoHide;
    }
  }.bind(this));


}
SocialSidebar.prototype = {
  __proto__: baseWidget.prototype,
  get browser() {
    return document.getElementById("social-status-sidebar-browser");
  },
  create: function(aWindow) {
    let self = this;
    let XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

    // We insert a vbox as a child of 'browser', as an immediate sibling of 'appcontent'
    let vbox = this._widget = document.createElementNS(XUL_NS, "vbox");
    vbox.setAttribute("id", "social-vbox");
    vbox.setAttribute("width", "140");
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
      self.reflow();
    });
    splitter.addEventListener("mouseup", function() {
      self.reflow();
    });

    document.getElementById('browser').insertBefore(vbox, after.nextSibling);
    document.getElementById('browser').insertBefore(splitter, after.nextSibling);
  
    cropper.appendChild(sbrowser);

    // Make sure the browser stretches and shrinks to fit
    window.addEventListener('resize', function(e) {
      if (e.target == window) self.reflow();
    }, true);
    
    // XXX hardcode reflowing for the single sbrowser on initial load for now
    sbrowser.addEventListener("DOMContentLoaded", function onLoad() {
      sbrowser.removeEventListener("DOMContentLoaded", onLoad);
      self.reflow();
    });
  
    this.attachContextMenu();
  
    Object.defineProperty(sbrowser, "visibility", {
      get: function() {
        if (vbox.getAttribute("hidden") == "true") {
          return "hidden";
        }
        return "open";
      },
      set: function(newVal) {
        let hiddenVal;
        switch (newVal) {
          case "open":
            hiddenVal = false;
            break;
          case "hidden":
            hiddenVal = true;
            break;
          default:
            throw "invalid visibility state";
        }
        vbox.setAttribute("hidden", hiddenVal);
        splitter.setAttribute("hidden", hiddenVal);
        self.reflow();
      }
    });
    try {
      this.visibility = this._prefBranch.getBoolPref("enabled") ? this._prefBranch.getCharPref("visibility") : 'hidden';
    }
    catch (e) {}
  },
  attachContextMenu: function() {
    let {document, gBrowser} = this._widget.ownerDocument.defaultView;
    let vbox = this._widget;
    // create a popup menu for the browser.
    // XXX - can we consolidate the context menu with toolbar items etc
    // in a commandset?
    let popupSet = document.getElementById("mainPopupSet");
    let menu = document.createElement("menupopup");
    menu.id = "social-context-menu";
    menu.addEventListener("popupshowing", function(event) {
      let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                              .getService(Ci.mozISocialRegistry);
      let service = registry.currentProvider;
      if (!service || !service.enabled) {
        event.preventDefault();
        return ;
      }
      // and a "refresh" menu item.
      let menuitem = document.createElement( "menuitem" );
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
  },
  reflow: function() {
    let sbrowser = document.getElementById('social-status-sidebar-browser');

    let visibility = sbrowser.visibility;
    if (visibility == "hidden") {
      // is this class still correct?
      document.documentElement.classList.remove("social-open");
      return;
    }
    document.documentElement.classList.add("social-open");
    let vbox = document.getElementById('social-vbox');
    let cropper = document.getElementById('social-cropper');
  
    // Include the visual border thickness when calculating navbar height
    let sideWidth = vbox.getAttribute("width");
    let openHeight = window.gBrowser.boxObject.height;// + navHeight;
    cropper.style.height = openHeight + "px";
    sbrowser.style.height = openHeight + "px";
  },
  setProvider: function(aService) {
    let self = this;

    if (!aService.enabled || this.disabled) {
      return;// sanity check
    }
  
    // retarget the sidebar
    var sbrowser = document.getElementById("social-status-sidebar-browser");
    var make_visible = sbrowser.service && sbrowser.service !== aService;
    sbrowser.service = aService;
    // XXX when switching providers, always open
    if (make_visible)
      sbrowser.visibility = "open";
  
    // set up a locationwatcher
    try {
      if (sbrowser.watcher) {
        sbrowser.removeProgressListener(sbrowser.watcher);
        sbrowser.watcher = null;
      }
    }
    catch (e) {
      Cu.reportError(e);
    }
    // load the new service before we block redirects, etc
    sbrowser.contentWindow.location = aService.sidebarURL;
    sbrowser.addEventListener("DOMContentLoaded", function sb_contentListener() {
      sbrowser.removeEventListener("DOMContentLoaded", sb_contentListener, true);
      try {
        // Keep a reference to the listener so it doesn't get collected
        sbrowser.watcher = new SocialLocationWatcher({
          onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
            // We want to prevent the panel from loading any page that is not
            // within it's domain/pathPrefix
            if (aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_START &&
                aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_IS_DOCUMENT) {
              if (aRequest.name.indexOf(sbrowser.service.URLPrefix) != 0) {
                Services.console.logStringMessage("blocking document change to "+aRequest.name);
                aRequest.cancel(Cr.NS_BINDING_ABORTED);
                let parentWin = Services.wm.getMostRecentWindow("navigator:browser");
                let newTab = parentWin.gBrowser.addTab(aRequest.name);
                parentWin.gBrowser.selectedTab = newTab;
              }
            }
          }
        });
        sbrowser.addProgressListener(sbrowser.watcher, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
      }
      catch (e) {
        Cu.reportError(e);
      }
    }, true);
  },
  enable: function() {
    this.show();
    let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                            .getService(Ci.mozISocialRegistry);
    this.setProvider(registry.currentProvider);
  },
  disable: function() {
    // this sidebar is displaying this service;
    // turn everything off.
    let sbrowser = this.browser;
    try {
      if (sbrowser.watcher)
        sbrowser.removeProgressListener(sbrowser.watcher);
    }
    catch(e) {
      Cu.reportError(e);
    }
    sbrowser.watcher = null;
    sbrowser.contentWindow.location = "about:blank";
    sbrowser.visibility = "hidden";
  },
  get disabled() {
    return this.browser.visibility == "hidden";
  },
  get visibility() {
    return this.browser.visibility;
  },
  set visibility(val) {
    this.browser.visibility = val;
    this._prefBranch.setCharPref("visibility", val);
  },
  show: function() {
    this.visibility = "open";
  },
  hide: function() {
    this.visibility = "hidden";
  },
  remove: function() {
    this._widget.parentNode.removeChild(this._widget.previousSibling); // remove splitter
    this._widget.parentNode.removeChild(this._widget);
  }
}


function SocialLocationWatcher(callbacks) {
  this._callbacks = callbacks;
}

SocialLocationWatcher.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                         Ci.nsIWebProgressListener2,
                                         Ci.nsISupportsWeakReference]),
  onStateChange: function(/*in nsIWebProgress*/ aWebProgress,
                     /*in nsIRequest*/ aRequest,
                     /*in unsigned long*/ aStateFlags,
                     /*in nsresult*/ aStatus) {
    if (this._callbacks.onStateChange) {
      this._callbacks.onStateChange(aWebProgress, aRequest, aStateFlags, aStatus);
    }
  },

  onProgressChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in long*/ aCurSelfProgress,
                        /*in long */aMaxSelfProgress,
                        /*in long */aCurTotalProgress,
                        /*in long */aMaxTotalProgress) {},
  onLocationChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in nsIURI*/ aLocation) {
    if (this._callbacks.onLocationChange) {
      this._callbacks.onLocationChange(aWebProgress, aRequest, aLocation);
    }
  },
  onStatusChange: function(/*in nsIWebProgress*/ aWebProgress,
                      /*in nsIRequest*/ aRequest,
                      /*in nsresult*/ aStatus,
                      /*in wstring*/ aMessage) {},
  onSecurityChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in unsigned long*/ aState) {},
}
