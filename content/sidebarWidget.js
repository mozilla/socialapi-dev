"use strict";

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/lib/listen.js");
Cu.import("resource://socialdev/lib/baseWidget.js");



function SocialSidebar() {
  baseWidget.call(this, window);
  this._currentAnchorId = null;
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
  
    // start with the sidebar closed.
    sbrowser._open = false;
  
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
    listen(window, window, "resize", function({target}) {
      if (target == window) {
        self.reflow();
      }
    });
    listen(window, document.getElementById('navigator-toolbox'), "DOMAttrModified", function(event) {
      if (event.attrName == "collapsed" || event.attrName == "tabsontop") {
        // so, one of the toolbars changed state.  If this means our "anchor"
        // changed then we need to reflow (which will re-anchor).
        let newAnchor = self._findAnchor();
        if (self._currentAnchorId && newAnchor.getAttribute("id") != self._currentAnchorId) {
          self.reflow();
        }
      }
    });
  
    // XXX hardcode reflowing for the single sbrowser on initial load for now
    sbrowser.addEventListener("DOMContentLoaded", function onLoad() {
      sbrowser.removeEventListener("DOMContentLoaded", onLoad);
      self.reflow();
    });
  
    this.attachContextMenu();
    // Automatically open (and keep open) the sidebar if minimized when clicked
    vbox.addEventListener("click", function(event) {
      // ack - this is wrong - ideally we want "command" but it doesn't work.
      // check the button so a right-click doesn't do this *and* show the popup
      if (event.button != 0) {
        return;
      }
      if (sbrowser.visibility != "open") {
        sbrowser.visibility = "open";
      }
    });
  
    Object.defineProperty(sbrowser, "visibility", {
      get: function() {
        if (vbox.getAttribute("hidden") == "true") {
          return "hidden";
        }
        return sbrowser._open ? "open" : "minimized";
      },
      set: function(newVal) {
        let hiddenVal;
        switch (newVal) {
          case "open":
            hiddenVal = false;
            sbrowser._open = true;
            break;
          case "minimized":
            hiddenVal = false;
            sbrowser._open = false;
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

    let anchor = this._findAnchor();
    if (this._currentAnchorId && anchor.getAttribute("id") != this._currentAnchorId) {
      // reset the old anchor.
      let old = document.getElementById(this._currentAnchorId);
      old.style.paddingRight = "";
    }
    this._currentAnchorId = anchor.getAttribute("id");

    let visibility = sbrowser.visibility;
    if (visibility == "hidden") {
      // just reset the navbar stuff.
      anchor.style.paddingRight = "";
      // anything else?
      return;
    }
    let open = visibility == "open";
  
    if (open)
      document.documentElement.classList.add("social-open");
    else
      document.documentElement.classList.remove("social-open");
  
    let vbox = document.getElementById('social-vbox');
    let cropper = document.getElementById('social-cropper');
  
    // Include the visual border thickness when calculating navbar height
    let isMac = Services.appinfo.OS == "Darwin";
    let navHeight = anchor.clientHeight + (isMac ? 2 : 1);
    let openHeight = window.gBrowser.boxObject.height + navHeight;
    let sideWidth = vbox.getAttribute("width");
  
    let targetWindow = sbrowser.contentWindow.wrappedJSObject;
    anchor.style.paddingRight = sideWidth + "px";
    cropper.style.height = (open ? openHeight : navHeight) + "px";
    vbox.style.marginLeft = open ? "" : "-" + sideWidth + "px";
    vbox.style.marginTop =  "-" + navHeight + "px";
    sbrowser.style.height = openHeight + "px";
  
    // TODO XXX Need an API to inform the content page how big to make the header
    var header = targetWindow.document.getElementById("header");
    if (header) {
      var headerStyle = header.style;
      headerStyle.height = navHeight - 1 + "px";
      headerStyle.overflow = "hidden";
    }
  },
  _findAnchor: function() {
    // Find the element which is our "anchor" - ie, the bottom toolbar which
    // we overlap and thus adjust its padding.
    // I tried using the "box" model, but failed - boxes can theoretically be
    // traversed in layout order, but:
    // EG: last = document.getElementById('navigator-toolbox').boxObject.lastChild;
    // Now - "last" is an element but doesn't itself have a "boxObject", so it's
    // not clear how to continue traversing back from there in layout order.
    // (and the same basic issue may exist traversing forward)
    // So - just use the bounding rects.
    let anchor = null;
    let lowestBottom = 0;
    let look = document.getElementById('navigator-toolbox').firstChild;
    while (look) {
      if (look.getBoundingClientRect().bottom > lowestBottom) {
        anchor = look;
        lowestBottom = look.getBoundingClientRect().bottom;
      }
      look = look.nextSibling;
    }
    if (!anchor) {
      // should be impossible (but nothing is impossible ;)
      dump("EEEK - failed to find the last toolbar - using nav-bar\n");
      anchor = document.getElementById('nav-bar');
      // throw "failed to find the anchor"
    }
    return anchor;
  },
  setProvider: function(aService) {
    let self = this;

    if (!aService.enabled) {
      return;// sanity check
    }
  
    // retarget the sidebar
    var sbrowser = document.getElementById("social-status-sidebar-browser");
    sbrowser.service = aService;
    // XXX when switching providers, always open
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
        sbrowser.watcher = new SocialLocationWatcher(sbrowser.service.URLPrefix);
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
    this.reflow();
  },
  get disabled() {
    return this.browser.visibility == "hidden";
  },
  get visibility() {
    return this.browser.visibility;
  },
  set visibility(val) {
    this.browser.visibility = val;
  },
  show: function() {
    this.browser.visibility = this.browser._open ? "open" : "minimized";
    this.reflow();
  },
  hide: function() {
    this.browser.visibility = "hidden";
    this.reflow();
  },
  remove: function() {
    this._widget.parentNode.removeChild(this._widget.previousSibling); // remove splitter
    this._widget.parentNode.removeChild(this._widget);
    // restore the toolbar style stuff we mangled.
    if (this._currentAnchorId) {
      let anchor = document.getElementById(this._currentAnchorId);
      anchor.style.paddingRight = "";
    }
  }
}


function SocialLocationWatcher(prefix) {
  this._prefix = prefix;
}
SocialLocationWatcher.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                         Ci.nsIWebProgressListener2,
                                         Ci.nsISupportsWeakReference]),
  // We want to prevent the panel from loading any page that is not
  // within it's domain/pathPrefix
  onStateChange: function(/*in nsIWebProgress*/ aWebProgress,
                     /*in nsIRequest*/ aRequest,
                     /*in unsigned long*/ aStateFlags,
                     /*in nsresult*/ aStatus)
  {
    if (aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_START &&
        aStateFlags & Components.interfaces.nsIWebProgressListener.STATE_IS_DOCUMENT) {
      if (aRequest.name.indexOf(this._prefix) != 0) {
        Services.console.logStringMessage("blocking document change to "+aRequest.name);
        aRequest.cancel(Cr.NS_BINDING_ABORTED);
        let parentWin = Services.wm.getMostRecentWindow("navigator:browser");
        let newTab = parentWin.gBrowser.addTab(aRequest.name);
        parentWin.gBrowser.selectedTab = newTab;
      }
    }
  },

  // here for the interface, we don't care about any of these
  onProgressChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in long*/ aCurSelfProgress,
                        /*in long */aMaxSelfProgress,
                        /*in long */aCurTotalProgress,
                        /*in long */aMaxTotalProgress) {},
  onLocationChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in nsIURI*/ aLocation) {},
  onStatusChange: function(/*in nsIWebProgress*/ aWebProgress,
                      /*in nsIRequest*/ aRequest,
                      /*in nsresult*/ aStatus,
                      /*in wstring*/ aMessage) {},
  onSecurityChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in unsigned long*/ aState) {},
}
