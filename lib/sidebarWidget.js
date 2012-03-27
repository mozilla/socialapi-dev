"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://socialdev/lib/console.js");
Cu.import("resource://socialdev/lib/listen.js");
Cu.import("resource://socialdev/lib/registry.js");
Cu.import("resource://socialdev/lib/baseWidget.js");

const EXPORTED_SYMBOLS = ["Sidebar"];

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const isMac = Services.appinfo.OS == "Darwin";


function Sidebar(aWindow) {
  baseWidget.call(this, aWindow);
  this._currentAnchorId = null;
}
Sidebar.prototype = {
  __proto__: baseWidget.prototype,
  get window() {
    return this._widget.ownerDocument.defaultView;
  },
  get browser() {
    return this.window.document.getElementById("social-status-sidebar-browser");
  },
  create: function(aWindow) {
    let self = this;
    let {document, gBrowser} = aWindow;
  
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
    listen(aWindow, aWindow, "resize", function({target}) {
      if (target == aWindow) {
        self.reflow();
      }
    });
    listen(aWindow, document.getElementById('navigator-toolbox'), "DOMAttrModified", function(event) {
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
  
    this.attacheContextMenu();
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
  attacheContextMenu: function() {
    let {document, gBrowser} = this._widget.ownerDocument.defaultView;
    let vbox = this._widget;
    // create a popup menu for the browser.
    // XXX - can we consolidate the context menu with toolbar items etc
    // in a commandset?
    let popupSet = document.getElementById("mainPopupSet");
    let menu = document.createElement("menupopup");
    menu.id = "social-context-menu";
    menu.addEventListener("popupshowing", function(event) {
      let service = providerRegistry().currentProvider;
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
    let window = this._widget.ownerDocument.defaultView;
    let sbrowser = window.document.getElementById('social-status-sidebar-browser');

    let anchor = this._findAnchor();
    if (this._currentAnchorId && anchor.getAttribute("id") != this._currentAnchorId) {
      // reset the old anchor.
      let old = window.document.getElementById(this._currentAnchorId);
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
      window.document.documentElement.classList.add("social-open");
    else
      window.document.documentElement.classList.remove("social-open");
  
    let vbox = window.document.getElementById('social-vbox');
    let cropper = window.document.getElementById('social-cropper');
  
    // Include the visual border thickness when calculating navbar height
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
    // Use the boxObject to traverse as it uses the order of display.
    let document = this.window.document;
    let bo = document.getElementById('navigator-toolbox').boxObject;
    // Ideally we would traverse in reverse, but the last node doesn't itself
    // have a box object!  We are looking for the last one *with* a box and
    // that isn't collapsed.
    let look = bo.firstChild;
    let anchor = null;
    while (look && look.boxObject) {
      if (!look.collapsed) {
        anchor = look;
      }
      look = look.boxObject.nextSibling;
    }
    if (!anchor) {
      // should be impossible!

      // it is NOT impossible, this is happening to me.  falling back for now.
      return document.getElementById('nav-bar');
      // throw "failed to find the anchor"
    }
    return anchor;
  },
  setProvider: function(aService) {
    let self = this;
    let window = this._widget.ownerDocument.defaultView;

    console.log("setVisibleService " + aService.origin);
  
    if (!aService.enabled) {
      console.log("service is not enabled")
      return;// sanity check
    }
  
    // retarget the sidebar
    var sbrowser = window.document.getElementById("social-status-sidebar-browser");
    sbrowser.service = aService;
    sbrowser.contentWindow.location = aService.sidebarURL;
    // XXX when switching providers, always open
    sbrowser.visibility = "open";
  
    // set up a locationwatcher
    try {
      sbrowser.removeProgressListener(sbrowser.watcher);
    } catch (e) {
      Cu.reportError(e);
    }
    try {
      // Keep a reference to the listener so it doesn't get collected
      sbrowser.watcher = new LocationWatcher(sbrowser.service.URLPrefix);
      sbrowser.addProgressListener(sbrowser.watcher, Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT);
    } catch (e) {
      Cu.reportError(e);
    }
  },
  enable: function() {
    this.show();
    this.setProvider(providerRegistry().currentProvider);
  },
  disable: function() {
    // this sidebar is displaying this service;
    // turn everything off.
    let sbrowser = this.browser;
    try {
      if (sbrowser.watcher)
        sbrowser.removeProgressListener(sbrowser.watcher);
    } catch(e) {
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
      let anchor = this.window.document.getElementById(this._currentAnchorId);
      anchor.style.paddingRight = "";
    }
  }
}


function LocationWatcher(prefix) {
  this._prefix = prefix;
}
LocationWatcher.prototype = {
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
        console.log("blocking document change to "+aRequest.name);
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
