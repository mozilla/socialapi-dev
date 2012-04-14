"use strict";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/modules/baseWidget.js");



function SocialSidebar() {
  this._prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);
  baseWidget.call(this, window);
  
  // watch for when browser disables chrome in tabs, and hide the social sidebar
  let _visibleBeforeAutoHide = this.visible;
  document.addEventListener('DOMAttrModified', function(e) {
    if (e.target == document.documentElement && e.attrName == "disablechrome") {
      if (e.newValue) {
        _visibleBeforeAutoHide = this.visible;
        this.visible = false;
      }
      else
        this.visible = _visibleBeforeAutoHide;
    }
  }.bind(this));


}
SocialSidebar.prototype = {
  __proto__: baseWidget.prototype,
  get browser() {
    return document.getElementById("social-status-sidebar-browser");
  },
  create: function(aWindow) {
    // XXX - todo - move the context menu to the overlay!
    this.attachContextMenu();

  },
  attachContextMenu: function() {
    let {document, gBrowser} = this.browser.ownerDocument.defaultView;
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
  },
  setProvider: function(aService) {
    let self = this;

    if (!aService.enabled || !window.social.enabled) {
      return;// sanity check
    }
  
    // retarget the sidebar
    var sbrowser = document.getElementById("social-status-sidebar-browser");
    var make_visible = !sbrowser.service || sbrowser.service !== aService;
    sbrowser.service = aService;
    // XXX when switching providers, always open
    if (make_visible)
      this.visible = true;

    // avoid resetting the sidebar if we're already loaded.  this fixes
    // browserid use in demoservice, removes a double reload that is
    // happening from somthing upstream.
    if (sbrowser.contentWindow.location == aService.sidebarURL) return;
  
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
    let sbrowser = this.browser;
    let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
                            .getService(Ci.mozISocialRegistry);
    this.setProvider(registry.currentProvider);
    try {
      this.visible = this._prefBranch.getBoolPref("visible"); 
    } catch(e) {
      this.visible = true;
    }
  },
  disable: function() {
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
    this.visible = false;
    sbrowser.contentWindow.location = "about:blank";
  },
  get visible() {
    let broadcaster = document.getElementById("socialSidebarVisible");
    return broadcaster.getAttribute("hidden") != "true";
  },
  set visible(val) {
    // if social is disabled we don't set the pref as the visibility state
    // is being changed due to that.
    if (window.social.enabled) {
      this._prefBranch.setBoolPref("visible", val);
    }
    // let the UI know - the "observes" magic means this is all that is
    // necessary to show or hide it.
    let broadcaster = document.getElementById("socialSidebarVisible");
    broadcaster.setAttribute("checked", val ? "true" : "false");
    broadcaster.setAttribute("hidden", val ? "false" : "true");
  },
  show: function() {
    this.visible = true;
  },
  hide: function() {
    this.visible = false;
  },
  remove: function() {
    // no concept of "remove" in our overlay based world!
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
