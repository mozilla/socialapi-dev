// These prefs are a long story :)
// * When we work as an addon, we are restartless, so defaults/preferences/*.js
//   isn't supported (see bug 564675 )
// * When built into FF we are *not* restartless, but also not stored in a
//   place where the DirectoryService knows about us, so defaults/preferences/*.js
//   doesn't work there either!
// * Given we are restartless in one context but not in another, bootstrap.js
//   isn't used in both contexts - so having it manage the prefs doesn't work.
// SO: we just explicitly set the default preferences as we are imported and
// rely on the fact this module gets imported early enough to set things up
// before code that relies on the preferences existing gets run.
// Also, note these need to be setup each run - see
// http://starkravingfinkle.org/blog/2011/01/restartless-add-ons-%E2%80%93-default-preferences/
// for more info.

Components.utils.import("resource://gre/modules/Services.jsm");

const PREF_BRANCH = "social.provider.";
const PREFS = {
  enabled: false,
  visible: false,
  current: ""
};

function setDefaultPrefs() {
  let branch = Services.prefs.getDefaultBranch(PREF_BRANCH);
  for (let [key, val] in Iterator(PREFS)) {
    switch (typeof val) {
      case "boolean":
        branch.setBoolPref(key, val);
        break;
      case "number":
        branch.setIntPref(key, val);
        break;
      case "string":
        branch.setCharPref(key, val);
        break;
    }
  }
}

// Always set the default prefs as they disappear on restart
setDefaultPrefs();

EXPORTED_SYMBOLS=['setDefaultPrefs'];
