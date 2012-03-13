/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=2 et sw=2 tw=80: */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is socialdev.
 *
 * The Initial Developer of the Original Code is The Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2012
 * the Initial Developer. All Rights Reserved.
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

/*
* A window containing a single browser instance for use by social providers.
*/

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
const EXPORTED_SYMBOLS = ["ChatWindow"];

Cu.import("resource://gre/modules/Services.jsm");

const isMac = Services.appinfo.OS == "Darwin";
const isWin = Services.appinfo.OS == "WINNT";

var xulNs = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
var xhtmlNs = "http://www.w3.org/1999/xhtml";

function ChatWindow() {}
ChatWindow.prototype = {
    open: function(options) {


	var frontMatter = '<?xml version="1.0"?>' +
          (isMac ? '<?xul-overlay href="chrome://browser/content/macBrowserOverlay.xul"?>' : '<?xml-stylesheet href="chrome://browser/skin/" type="text/css"?>') +
	    '<window id="main-window" windowtype="socialdev:chat" xmlns:html="'+ xhtmlNs+'" xmlns="' + xulNs + '" chromemargin="0,-1,-1,-1">';
	var chatXul = frontMatter;

  // On Windows Vista/7, we attach an app menu:
  if (isWin) {
    if (options.title) {
        chatXul +='<vbox style="-moz-appearance: -moz-window-titlebar; -moz-binding: url(\'chrome://global/content/bindings/general.xml#windowdragbox\')" '+
      'id="titlebar"><hbox id="titlebar-content"><hbox id="appmenu-button-container"><button id="appmenu-button" type="menu" label="' +
      options.title + '" style="-moz-user-focus: ignore;">' +
      '<menupopup id="appmenu-popup"><menuitem id="appmenu_closeWindow" class="closeWindow" label="Close window" oncommand="closeWindow();" disabled="false"/></menupopup>'+
                  '</button>   </hbox> <spacer id="titlebar-spacer" flex="1"/>    <hbox id="titlebar-buttonbox-container" align="start"><hbox id="titlebar-buttonbox">       '+
      '<toolbarbutton class="titlebar-button" id="titlebar-min" oncommand="window.minimize();"/>    '+
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

    this._window = window;
    this.options = options;

    if (this.options.onClose) {
      window.addEventListener("close", this.options.onClose, false);
    }

    // We catch the first DOMContentLoaded, which means the XUL
    // document has loaded.
    var onXULReady = function(evt) {
      //console.log("DOMContentLoaded "+evt.target.location);
      if (this.options.onReady) this.options.onReady();
      //window.removeEventListener("DOMContentLoaded", onXULReady);
    }.bind(this);

    window.addEventListener("DOMContentLoaded", onXULReady, false);

  },
  get browser() {
    return this._window.document.getElementById('browser');
  },
  get title() {
    return this._window.title;
  },
  set title(val) {
    this._window.document.title = val;
  },
  setTitle: function(val) {
    dump("chatWindow setTitle: " + val + "\n");
    this._window.document.title = val;
  },
  loadURI: function(URI) {
    this.options.url = URI;
    this.browser.setAttribute('src', URI);
  },
  focus: function() this._window.focus(),
  close: function() {
    this._window.close();
  }
};

