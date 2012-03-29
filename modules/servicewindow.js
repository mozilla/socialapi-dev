/* -*- Mode: JavaScript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Contributor(s):
 *  Michael Hanson <mhanson@mozilla.com>
 *  Edward Lee <edilee@mozilla.com>
 *  Mark Hammond <mhammond@mozilla.com>
 *  Shane Caraveo <scaraveo@mozilla.com>
 */

/*
* A window containing a single browser instance for use by social providers.
*/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const EXPORTED_SYMBOLS = ["createServiceWindow", "closeWindowsForService", "serviceWindowMaker"];

Cu.import("resource://gre/modules/Services.jsm");

const isMac = Services.appinfo.OS == "Darwin";
const isWin = Services.appinfo.OS == "WINNT";

var xulNs = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
var xhtmlNs = "http://www.w3.org/1999/xhtml";

const SOCIAL_WINDOWTYPE = "socialdev:window";


function serviceWindowMaker(options) {

  var chatXul = '<?xml version="1.0"?>' +
    (isMac ? '<?xul-overlay href="chrome://browser/content/macBrowserOverlay.xul"?>' : '<?xml-stylesheet href="chrome://browser/skin/" type="text/css"?>') +
             '<window id="main-window" windowtype="' + SOCIAL_WINDOWTYPE + '" xmlns:html="'+ xhtmlNs+'" xmlns="' + xulNs + '" chromemargin="0,-1,-1,-1">';

  // On Windows Vista/7, we attach an app menu:
  if (isWin) {
    if (options.title) {
      chatXul +='<vbox style="-moz-appearance: -moz-window-titlebar; -moz-binding: url(\'chrome://global/content/bindings/general.xml#windowdragbox\')" '+
    'id="titlebar"><hbox id="titlebar-content"><hbox id="appmenu-button-container"><button id="appmenu-button" type="menu" label="' +
    options.title + '" style="-moz-user-focus: ignore;">' +
    '<menupopup id="appmenu-popup"><menuitem id="appmenu_closeWindow" class="closeWindow" label="Close window" oncommand="closeWindow();" disabled="false"/></menupopup>'+
          '</button>   </hbox> <spacer id="titlebar-spacer" flex="1"/>  <hbox id="titlebar-buttonbox-container" align="start"><hbox id="titlebar-buttonbox">     '+
    '<toolbarbutton class="titlebar-button" id="titlebar-min" oncommand="window.minimize();"/>  '+
    '<toolbarbutton class="titlebar-button" id="titlebar-max" oncommand="onTitlebarMaxClick();"/>  '+
    '<toolbarbutton class="titlebar-button" id="titlebar-close" command="cmd_closeWindow"/></hbox></hbox>  </hbox></vbox>';
    }
  }
  chatXul += '<browser id="browser" src="'+options.url+'" disablehistory="indeed" type="content-primary" flex="1" height="100%"/>' +
      // #include browserMountPoints.inc
      (isMac ? '<stringbundleset id="stringbundleset"/><commandset id="mainCommandSet"/><commandset id="baseMenuCommandSet"/><commandset id="placesCommands"/><broadcasterset id="mainBroadcasterSet"/><keyset id="mainKeyset"/><keyset id="baseMenuKeyset"/><menubar id="main-menubar"/>' : '') +
      '<statusbar>'+
        '<statusbarpanel id="security-display" crop="end" flex="1"/>'+
        '<statusbarpanel id="security-status" crop="end" collapsed="true"/>'+
        '<statusbarpanel class="statusbarpanel-progress" collapsed="true" id="statusbar-status">'+
          '<progressmeter class="progressmeter-statusbar" id="statusbar-icon" mode="normal" value="0"/>'+
        '</statusbarpanel>'+
        '<statusbarpanel id="security-button" class="statusbarpanel-iconic"/>'+
      '</statusbar>'+
      '</window>';


  /* We now pass the options.url, which is the user app directly
    inserting it in the window, instead using the xul browser element
    that was here. This helped to make the session history work. */

  let ww = Cc["@mozilla.org/embedcomp/window-watcher;1"]
    .getService(Ci.nsIWindowWatcher);

  var url = "data:application/vnd.mozilla.xul+xml," + escape(chatXul);
  var window = ww.openWindow(null, url, options.name, options.features, options.arguments);

  // We catch the first DOMContentLoaded, which means the XUL
  // document has loaded.
  var onXULReady = function(evt) {
    if (options.onClose) {
      window.addEventListener("unload", function(e) {
        if (e.target == window.document) {
          options.onClose();
        }
      }, false);
    }
    var browser = window.document.getElementById('browser');
    browser.addProgressListener(SecurityStatusListener(window),
                                Ci.nsIWebProgress.NOTIFY_ALL);
    if (options.onReady) options.onReady();
  }

  window.addEventListener("DOMContentLoaded", onXULReady, false);

  Object.defineProperty(window, "browser", {
    get: function() { return window.document.getElementById('browser'); }
  });

  window.loadURI = function loadURI(URI) {
    options.url = URI;
    browser.setAttribute('src', URI);
  }
  return window;
}

function wrapServiceWindowForContent(aWindow)
{
  return {
    close: function() {
      aWindow.browser.contentWindow.close();
    },
    focus: function() {
      aWindow.browser.contentWindow.focus();
    },
    loadURI: function(URI) {
      aWindow.browser.setAttribute("src", URI);
    },
    setTitle: function(title) {
      aWindow.document.title = title;
    }
  }
}

// Passed to services to allow them to create new windows for themselves.
function createServiceWindow(toURL, name, options, withService, title, readyCallback)
{

  // See if we've already got one...
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    let sWindow = windows.getNext();
    if (sWindow.wrappedJSObject.service == withService && sWindow.wrappedJSObject.name == name) {
      if (readyCallback) readyCallback();
      return wrapServiceWindowForContent(sWindow);
    }
  }

  let opts = {
      features: options,
      name: name,
      url: toURL,
      title:title,

    onClose: function() {
    },

    onReady: function() {
      try {
        if ((aWind.browser.contentWindow.location.href).indexOf(withService.URLPrefix) != 0) {
          return;
        }
        aWind.browser.service = withService;
        if (readyCallback) readyCallback();
      }
      catch(e) {
        Cu.reportError(e);
      }
    }

  };
  var aWind = serviceWindowMaker(opts);
  aWind.service = withService;
  aWind.name = name;
  return wrapServiceWindowForContent(aWind);
}


function SecurityStatusListener(window) {
  let document = window.document;
  return {
    _isBusy: false,
    get statusMeter() {
      delete this.statusMeter;
      return this.statusMeter = document.getElementById("statusbar-icon");
    },
    get securityButton() {
      delete this.securityButton;
      return this.securityButton = document.getElementById("security-button");
    },
    get securityLabel() {
      delete this.securityLabel;
      return this.securityLabel = document.getElementById("security-status");
    },
    get securityDisplay() {
      delete this.securityDisplay;
      return this.securityDisplay = document.getElementById("security-display");
    },
    
    QueryInterface: function(aIID) {
      if (aIID.equals(Ci.nsIWebProgressListener)   ||
          aIID.equals(Ci.nsIWebProgressListener2)  ||
          aIID.equals(Ci.nsISupportsWeakReference) ||
          aIID.equals(Ci.nsISupports))
        return this;
      throw Components.results.NS_NOINTERFACE;
    },
    onStateChange: function(/*in nsIWebProgress*/ aWebProgress,
                       /*in nsIRequest*/ aRequest,
                       /*in unsigned long*/ aStateFlags,
                       /*in nsresult*/ aStatus) {
      if (aStateFlags & Ci.nsIWebProgressListener.STATE_START &&
          aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) {
        this.statusMeter.value = 0;
        this.statusMeter.parentNode.collapsed = false;
        this.securityLabel.collapsed = true;
      }
      else if (aStateFlags & Ci.nsIWebProgressListener.STATE_STOP &&
               aStateFlags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) {
        this.statusMeter.parentNode.collapsed = true;
        this.securityLabel.collapsed = false;
      }
    },
  
    onProgressChange: function(/*in nsIWebProgress*/ aWebProgress,
                          /*in nsIRequest*/ aRequest,
                          /*in long*/ aCurSelfProgress,
                          /*in long */aMaxSelfProgress,
                          /*in long */aCurTotalProgress,
                          /*in long */aMaxTotalProgress) {
      if (aMaxTotalProgress > 0) {
        let percentage = (aCurTotalProgress * 100) / aMaxTotalProgress;
        this.statusMeter.value = percentage;
      }
    },
  
    onLocationChange: function(/*in nsIWebProgress*/ aWebProgress,
                          /*in nsIRequest*/ aRequest,
                          /*in nsIURI*/ aLocation) {
      // XXX this needs to be cleaned up to handle differences better, the
      // callback url should be configurable as well
      this.securityDisplay.setAttribute('label', aLocation.host);
    },
  
    onStatusChange: function(/*in nsIWebProgress*/ aWebProgress,
                        /*in nsIRequest*/ aRequest,
                        /*in nsresult*/ aStatus,
                        /*in wstring*/ aMessage) {
    },
  
    onSecurityChange: function(/*in nsIWebProgress*/ aWebProgress,
                          /*in nsIRequest*/ aRequest,
                          /*in unsigned long*/ aState) {
      const wpl_security_bits = Ci.nsIWebProgressListener.STATE_IS_SECURE |
                                Ci.nsIWebProgressListener.STATE_IS_BROKEN |
                                Ci.nsIWebProgressListener.STATE_IS_INSECURE |
                                Ci.nsIWebProgressListener.STATE_SECURE_HIGH |
                                Ci.nsIWebProgressListener.STATE_SECURE_MED |
                                Ci.nsIWebProgressListener.STATE_SECURE_LOW;
      var browser = document.getElementById("browser");
      var level;
      
      switch (aState & wpl_security_bits) {
        case Ci.nsIWebProgressListener.STATE_IS_SECURE | Ci.nsIWebProgressListener.STATE_SECURE_HIGH:
          level = "high";
          break;
        case Ci.nsIWebProgressListener.STATE_IS_SECURE | Ci.nsIWebProgressListener.STATE_SECURE_MED:
        case Ci.nsIWebProgressListener.STATE_IS_SECURE | Ci.nsIWebProgressListener.STATE_SECURE_LOW:
          level = "low";
          break;
        case Ci.nsIWebProgressListener.STATE_IS_BROKEN:
          level = "broken";
          break;
      }
      if (level) {
        this.securityButton.setAttribute("level", level);
        this.securityButton.hidden = false;
        this.securityLabel.setAttribute("label", browser.securityUI.tooltipText);
      }
      else {
        this.securityButton.hidden = true;
        this.securityButton.removeAttribute("level");
      }
      this.securityButton.setAttribute("tooltiptext", browser.securityUI.tooltipText);
    },
    onProgressChange64: function() {
      return this.onProgressChange(aWebProgress, aRequest,
        aCurSelfProgress, aMaxSelfProgress, aCurTotalProgress,
        aMaxTotalProgress);
    },
    onRefreshAttempted: function() {
      return true;
    }
  }
}

function closeWindowsForService(aService)
{
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    let window = windows.getNext();
    let {documentElement} = window.document;
    if (documentElement.getAttribute("windowtype") == SOCIAL_WINDOWTYPE) {
      if (window.service == aService) {
        window.close();
      }
    }
  }
}