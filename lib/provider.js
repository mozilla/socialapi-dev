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
 const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://socialdev/lib/console.js");
let frameworker = {};
Cu.import("resource://socialdev/lib/frameworker.js", frameworker);
Cu.import("resource://gre/modules/NetUtil.jsm", this);

const EXPORTED_SYMBOLS = ["SocialProvider"];

function SocialProvider(input) {

	this.name = input.name;
	this.workerURL = input.workerURL;
	this.sidebarURL = input.sidebarURL;
	this.URLPrefix = input.URLPrefix;
	this.iconURL = input.inputURL;
	this.contentPatch = input.contentPatch;
	this.contentPatchPath = input.contentPatchPath;
	return this;
}

SocialProvider.prototype = {

	_log: function(msg) {
		console.log(new Date().toISOString() + " [" + this.name + " service]: " + msg);
	},

	init: function(windowCreatorFn, callback) {
		this._log("init");
		this.windowCreatorFn = windowCreatorFn;
		// Should we create the Worker right away?  Probably.

		let self = this;

		if (this.contentPatchPath) {
			this._log("Starting async load of " + this.contentPatchPath);

			// XXX we probably just want to rip our contentPatching,
			// but for now we put in a sanity check.
			if (this.contentPatchPath.indexOf("resource:") != 0) {
				this._log("Content patching is only allowed from resource: URLs");
				return;
			}
			let channel = NetUtil.newChannel(this.contentPatchPath);
			NetUtil.asyncFetch(channel, function(aInputStream, aResult) {

				try {

					if (!Components.isSuccessCode(aResult)) {
						// Handle error
						this._log("Error while loading content patch");
						return;
					}

					// Consume the input stream.
					// XXXX blocking I/O, what's the right way to do this???
					var buf = [];
					do {
						/// XXX how to handle looping for slow I/O?  it's always
						// coming from disk, maybe we're okay.
						var avail = aInputStream.available();
						console.log("requesting " + avail + " bytes");
						var part = NetUtil.readInputStreamToString(aInputStream, avail);
						buf += part;
						break;
					} while (true);

					self.contentPatch = buf;
					self._log("calling provider init callback after reading " + self.contentPatch.length + " bytes");
					callback();
				} catch (e) {
					console.log("Error while loading content patch: " + e);
					console.log(e.stack);

				}
			});
		} else {
			this._log("calling init callback");
			callback();
		}
	},
	shutdown: function() {
		try {
			this._log("shutdown");
			var worker = this.makeWorker(null);
			worker.port.close(); // shouldn't be necessary...
			worker.terminate();
		} catch (e) {
			this._log(e);
		}
	},
	makeWorker: function(window) {
		// XXX - todo - check the window origin to match the service prefix
		if (this.workerURL) {
			return frameworker.FrameWorker(this.workerURL);
		} else {
			this._log("makeWorker cannot create worker: no workerURL specified");
			throw new Exception("makeWorker cannot create worker: no workerURL specified");
		}
	},
	attachToWindow: function(targetWindow, tabOpenerFn, windowOpenerFn) {

		this._log("attachToWindow");
		var worker = this.makeWorker(targetWindow.wrappedJSObject);

		worker.port.onmessage = function(e) {
			this._log("worker message: " + JSON.stringify(e));
		};

		var self = this;
		targetWindow.wrappedJSObject.navigator.mozSocial = {
			// XXX - why a function?  May mis-lead people into
			// thinking it is creating a *new* worker which
			// can/should have its port closed (which this one
			// should not) AND may cause people to think a new
			// onmessage handler can be added (which would screw us)
			getWorker: function() {
					return worker;
			},
			openServiceWindow: function(toURL, name, options, title, readyCallback) {
				return windowOpenerFn(toURL, name, options, self, title, readyCallback);
			}
		}

		targetWindow.external = {};
		if (this.contentPatch) {
			this._log("Applying content patch");
			let sandbox = new Cu.Sandbox(targetWindow, {
				sandboxPrototype: targetWindow,
				wantXrays: false
			});
			try {
				Cu.evalInSandbox(this.contentPatch, sandbox, "1.8");
				this._log("Successfully applied content patch");
			} catch (e) {
				this._log("Error while applying content patch: " + e);
			}
		} else {
			this._log("No content patch");
		}

		targetWindow.addEventListener("unload", function() {
			try {
				worker.port.close();
			} catch(e) {
				this._log("Exception while closing worker: " + e);
			}
		}, false);

	},
	windowClosing: function(aWindow) {
		// assume for now that we only allow one window per service
		if (aWindow == this.serviceWindow) {
			this.serviceWindow = null;
		}
	}

}
