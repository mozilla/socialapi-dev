"use strict";

Cu.import("resource://socialdev/modules/baseWidget.js");

// These are widgets than can be created only after we become enabled.
// The toolbar widget is always created at startup so isn't here...
let widgetMap = {
  recommendButton: SocialRecommendButton,
  sidebar: SocialSidebar,
};

// A "fake" widget - never shown, just leverages the observer stuff from
// baseWidget.

// the short-lived singleton
let _stateWidget;

function stateWidget() {
  baseWidget.call(this, window);
}

stateWidget.prototype = {
  __proto__: baseWidget.prototype,

  enable: function() {
    dump("social initial enable\n")
    window.social.enabled = true;
    for (let name in widgetMap) {
      if (typeof window.social[name] === "undefined") {
        try {
          let w = window.social[name] = new widgetMap[name](window);
          w.enable();
        } catch (ex) {
          Cu.reportError(ex);
        }
      }
    }
    this.remove();
    _stateWidget = null;
  },
};

function social_main() {
  window.social = {};
  // due to what we are doing in the sidebar, we have to wait for the
  // chromeWindow to load before we do our magic
  window.addEventListener('load', function loadHandler(e) {
    window.removeEventListener('load', loadHandler);
    let prefBranch = Services.prefs.getBranch("social.provider.").QueryInterface(Ci.nsIPrefBranch2);

    // XXX this should be in a proper preferences.js
    if (!prefBranch.prefHasUserValue("enabled")) prefBranch.setBoolPref("enabled", true);

    let _enabled = prefBranch.getBoolPref("enabled"); // poor-mans cache.
    window.social = {
      get enabled() {
        return _enabled;
      },
      set enabled(val) {
        if (_enabled != val) {
          _enabled = val;
          prefBranch.setBoolPref("enabled", val);
          let topic = val ? "social-browsing-enabled" : "social-browsing-disabled";
          Services.obs.notifyObservers(null, topic, null);
        }
      }
    };
    dump("social startup - enabled=" + _enabled + "\n");
    let tsa = window.social.toolbarStatusArea = new SocialToolbarStatusArea(window);
    (_enabled ? tsa.enable : tsa.disable)();

    _stateWidget = new stateWidget();
    if (_enabled) {
      _stateWidget.enable();
    }
    // if we are disabled so there is nothing to do - our "stateWidget"
    // will notice when we become enabled and bootstrap everything else.
  });
}

social_main();
