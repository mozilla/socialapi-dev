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
 * Portions created by the Initial Developer are Copyright (C) 2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *	Anant Narayanan <anant@kix.in>
 *	Shane Caraveo <shanec@mozillamessaging.com>
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

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

function registerProtocol(scheme, installPath, name) {
    let resource = Services.io.getProtocolHandler(scheme)
                   .QueryInterface(Ci.nsIResProtocolHandler);
    let alias = Services.io.newFileURI(installPath);
    if (!installPath.isDirectory())
        alias = Services.io.newURI("jar:" + alias.spec + "!/", null, null);
    Services.console.logStringMessage("setting alias for "+scheme+" to "+alias.spec+"\n");
    resource.setSubstitution(name, alias);
}

function getAddonShortName(name) {
    return name.split('@')[0];
}

function startup(data, reason) AddonManager.getAddonByID(data.id, function(addon) {
    // XXX the purpose for the shortname is to auto-build a resource url that
    // is then used by the addon.  This requires the addon have an id that
    // is in the name@domain format.  'name' will become the domain for the
    // resource.  A better mechanism for this would be great.
    let id = getAddonShortName(data.id);
    registerProtocol("resource", data.installPath, id);


    // load startAddon.  This is where the addon logic should actually start
    try {
        Cu.import("resource://"+id+"/lib/main.js").startup(data);
    }
    catch (e) {
        Cu.reportError("Startup error: " + e + "\n");
    }
});

function shutdown(data, reason) {
    if (reason == APP_SHUTDOWN) return;

    let id = getAddonShortName(data.id);
    Cu.import("resource://"+id+"/lib/main.js").shutdown(data);
    let resource = Services.io.getProtocolHandler("resource")
                   .QueryInterface(Ci.nsIResProtocolHandler);
    resource.setSubstitution(id, null);
}

function install() {
}

function uninstall() {
}
