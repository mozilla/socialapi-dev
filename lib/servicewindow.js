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
const EXPORTED_SYMBOLS = ["createServiceWindow", "serviceWindowMaker"];

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://socialdev/lib/unload+.js");

const isMac = Services.appinfo.OS == "Darwin";
const isWin = Services.appinfo.OS == "WINNT";

var xulNs = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
var xhtmlNs = "http://www.w3.org/1999/xhtml";

const SOCIAL_WINDOWTYPE = "socialdev:window";

unload(function() {
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    // Only run the watcher immediately if the window is completely loaded
    let window = windows.getNext();
    let {documentElement} = window.document;
    if (documentElement.getAttribute("windowtype") == SOCIAL_WINDOWTYPE) {
      window.close();
    }
  }
});

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



// Passed to services to allow them to create new windows for themselves.
function createServiceWindow(toURL, name, options, withService, title, readyCallback)
{

  // See if we've already got one...
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    let sWindow = windows.getNext().wrappedJSObject;
    if (sWindow.service == withService && sWindow.name == name) {
      if (readyCallback) readyCallback();
      return sWindow;
    }
  }

  let opts = {
      features: options,
      name: name,
      url: toURL,
      title:title,

    onClose: function() {
      try {
        withService.windowClosing(aWind);
      } catch (e) {}
    },

    onReady: function() {
      try {
        if ((aWind.browser.contentWindow.location.href).indexOf(withService.URLPrefix) != 0) {
          return;
        }
        aWind.browser.service = withService;
        if (readyCallback) readyCallback();
      } catch(e) {
        Cu.reportError(e);
      }
    }

  };
  var aWind = serviceWindowMaker(opts);
  aWind.service = withService;
  aWind.name = name;
  return aWind;
}
