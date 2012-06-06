# This is a script with a very specific purpose - to keep 2 different
# hg branches in sync with a single git repo.
# One of the hg branches is assumed to have a subset of the files in the git
# repo, while the other branch has (more or less) the complete set of files.
#
# You can update the files in this git repo and run the script to update the
# hg repo - it will determine what hg branch is being used and therefore which
# files need to be copied.
#
# This entire file can go away once the multi-branch strategy is dropped.
#
# WARNING - if you made changes directly in the hg repo, this script
# will OVERWRITE any such changes.  Sadly checking the timestamp on the files
# doesn't work as hg updates files to the current time when switching
# branches.

import os
import optparse
import subprocess
import shutil
import re

options = None # will be set by main()

class ProgramFailedError(Exception):
    pass

def get_hg_branchname(srcdir):
    p = subprocess.Popen(['hg', 'branch'], cwd=srcdir,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE);
    stdout, stderr = p.communicate()
    if p.returncode:
        raise ProgramFailedError(stderr);
    return stdout.strip()

def build_hg_filelist(srcdir):
    p = subprocess.Popen(['hg', 'status', '--all', '.'], cwd=srcdir,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE);
    stdout, stderr = p.communicate()
    if p.returncode:
        raise ProgramFailedError(stderr);
    split = [l.split(" ", 1) for l in stdout.splitlines()]
    # we return a dict - key is the name, value is the hg status (even though
    # we don't use the hg status yet, and probably never will!)
    return dict([(name.replace("\\", "/"), status) for (status, name) in split])

# There are one or 2 files that are different depending on the branch being
# used in hg - so we adopt a simple naming convention:
# * files named "basename-branch-name.ext" as assumed to live in a branch "name"
# * files not matching that pattern are assumed to live in only 1 branch or
#   the other.
# Returns a list of [srcname, targetname]
def build_git_filelist(srcdir, hg_branchname):
    p = subprocess.Popen(['git', 'ls-files', '.'], cwd=srcdir,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE);
    stdout, stderr = p.communicate()
    if p.returncode:
        raise ProgramFailedError(stderr);
    r = re.compile("(.*)-branch-(.*)(\..*)")
    map = {}
    for name in stdout.splitlines():
        m = r.match(name)
        if m is None:
            targetname = name
            branchname = None
        else:
            branchname = m.group(2)
            targetname = m.group(1) + m.group(3)
        map.setdefault(targetname, {})[branchname] = name
    # Now select the appropriate ones for this branch.
    result = []
    for name, variations in map.iteritems():
        srcname = variations.get(hg_branchname)
        if srcname is None:
            srcname = variations.get(None)
        if srcname is None:
            # XXX - in a unified git repo we should throw.  For now we ignore
            #raise ValueError("%s doesn't have a branch-agnostic version" % (name,))
            continue
        result.append((srcname, name))
    return sorted(result)
    
def main():
    global options
    parser = optparse.OptionParser()
    parser.add_option("-f", "--force", action="store_true",
                      help="ignore all sanity checks and do it anyway");
    parser.add_option("-n", "--dry-run", dest="dry_run", action="store_true",
                      help="don't actually do anything");
    parser.add_option("-v", "--verbose", action="store_true",
                      help="show all the things");

    parser.add_option("", "--hgdir", dest="hgdir",
                      help="The root of the mozilla-central hg repo");

    parser.add_option("", "--gitdir", dest="gitdir",
                      help="The root of the social git repo");

    options, args = parser.parse_args()

    options.hgdir = os.path.abspath(options.hgdir)
    if not os.path.isdir(os.path.join(options.hgdir, ".hg")):
        parser.error("the specified --hgdir is not a valid hg repo")
    options.hgdir = os.path.join(options.hgdir, "browser/extensions/socialapi")
    if not os.path.isdir(options.hgdir):
        parser.error("the specified --hgdir does not have the socialapi directory")

    options.gitdir = os.path.abspath(options.gitdir)
    if not os.path.isdir(os.path.join(options.gitdir, ".git")):
        parser.error("the specified --gitdir is not a valid hg repo")

    hg_branchname = get_hg_branchname(options.hgdir)
    hgdict = build_hg_filelist(options.hgdir)
    gitlist = build_git_filelist(options.gitdir, hg_branchname)

    num = 0
    for srcname, targetname in gitlist:
        src = os.path.abspath(os.path.join(options.gitdir, srcname))
        dest = os.path.abspath(os.path.join(options.hgdir, targetname))
        if targetname in hgdict:
            num += 1
            print "update:", srcname, "->", targetname
            if not options.dry_run:
                shutil.copy2(src, dest)
        else:
            if options.verbose:
                print "skipped (not managed in target):", srcname
    print num, "file(s) updated."
    if options.dry_run:
        print "NOTE: --dry-run/-n was specified, so nothing actually happened."

if __name__=='__main__':
    main()
