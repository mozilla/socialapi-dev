const {classes: Cc, interfaces: Ci, utils: Cu, resources: Cr} = Components;

Cu.import("resource://gre/modules/PlacesUtils.jsm");
Cu.import("resource://socialdev/lib/manifestDB.jsm");

const EXPORTED_SYMBOLS = ["hasLogin", "installBuiltins", "frecencyForUrl"];

// some utility functions we can later use to determin if a "builtin" should
// be made available or not

function hasLogin(hostname) {
  try {
    var loginManager = Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);
    return loginManager.countLogins(hostname, "", "") > 0;
  } catch(e) {
    Cu.reportError(e);
  }
  return false;
}

function reverse(s){
    return s.split("").reverse().join("");
}

function frecencyForUrl(host)
{
  // BUG 732275 there has got to be a better way to do this!
  let dbconn = PlacesUtils.history.QueryInterface(Ci.nsPIPlacesDatabase)
                                  .DBConnection;
  let frecency = 0;
  let stmt = dbconn.createStatement(
    "SELECT frecency FROM moz_places WHERE rev_host = ?1"
  );
  try {
    stmt.bindByIndex(0, reverse(host)+'.');
    if (stmt.executeStep())
      frecency = stmt.getInt32(0);
  } finally {
    stmt.finalize();
  }

  return frecency;
}


// this is an ordered list, "least popular" to "most popular" which will
// be maintained in the case the user does not have any logins or frecency.
// the mediator will enable via login and frecency, and sort by frecency.
var builtins = [

];

function installBuiltins() {
  for each(let manifest in builtins) {
    //  initialize the db with our builtins
    // TODO if a real provider implementation is added later, we don't want to
    // overwrite that, however, if we're upgrading a builtin, we need to overwrite
    manifest.enabled = true;
    ManifestDB.insert(manifest.URLPrefix, manifest);
  }

}
