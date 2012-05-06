"use strict";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/modules/baseWidget.js");

Cu.import("resource://socialdev/components/registry.js");


function SocialSidebar() {
  baseWidget.call(this, window);
  Services.obs.addObserver(this, "social-sidebar-visible", false);
  Services.obs.addObserver(this, "social-sidebar-hidden", false);

}
SocialSidebar.prototype = {
  __proto__: baseWidget.prototype,
  get browser() {
    return document.getElementById("social-status-sidebar-browser");
  },
  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "social-sidebar-visible") {
      if (aSubject === window) {
        this.enable();
      }
    }
    else if (aTopic == "social-sidebar-hidden") {
      if (aSubject === window) {
        this.disable();
      }
    }
    else {
      baseWidget.prototype.observe.call(this, aSubject, aTopic, aData);
    }
  },
  create: function(aWindow) {
  },
  setProvider: function(aService) {
    if (!aService.enabled) {
      return;// sanity check
    }
  
    // retarget the sidebar
    var sbrowser = document.getElementById("social-status-sidebar-browser");
    var make_visible = !sbrowser.service || sbrowser.service !== aService;
    sbrowser.service = aService;
    // XXX when switching providers, always open
    if (make_visible) {
      // XXX - this is misplaced and should probably be in main.js
      let broadcaster = document.getElementById("socialSidebarVisible");
      broadcaster.setAttribute("hidden", "false");
      broadcaster.setAttribute("checked", "true");
    }

    // avoid resetting the sidebar if we're already loaded.  this fixes
    // browserid use in demoservice, removes a double reload that is
    // happening from somthing upstream.
    try {
      if (sbrowser.contentWindow.location == aService.sidebarURL) return;
    } catch(e) {
      // nightly throws exception?
      return;
    }
  
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
              if (aRequest.name.indexOf(sbrowser.service.URLPrefix) != 0 && aRequest.name.indexOf("file://") != 0) {
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
    // XXX - this is wrong and needs refactoring.
    //let registry = Cc["@mozilla.org/socialProviderRegistry;1"]
    //                    .getService(Ci.mozISocialRegistry);
    this.setProvider(registry().currentProvider);
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
    sbrowser.contentWindow.location = "about:blank";
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
