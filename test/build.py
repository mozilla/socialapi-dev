#!/usr/bin/python
from os import unlink, mkdir, chdir, system, unlink
from os.path import abspath, join, dirname, exists
from shutil import copy, copytree, rmtree

this_dir = dirname(__file__)

PROVIDERS = [
	"testprovider"
]

provider_path = abspath(join(this_dir, "testprovider"))
social_path = abspath(join(this_dir, "../"))
stage_path = abspath(join(this_dir, "../stage"))
xpi_name = abspath(join(this_dir, "socialdev@labs.mozilla.com.xpi"))

if exists(stage_path):
    rmtree(stage_path)
mkdir(stage_path)
if exists(xpi_name):
    unlink(xpi_name)

copy(join(social_path, "chrome.manifest"), stage_path)
copytree(join(social_path, "components"), join(stage_path, "components"))
copytree(join(social_path, "content"), join(stage_path, "content"))
copytree(join(social_path, "locale"), join(stage_path, "locale"))
copytree(join(social_path, "modules"), join(stage_path, "modules"))
copytree(join(social_path, "skin"), join(stage_path, "skin"))
copytree(join(social_path, "defaults"), join(stage_path, "defaults"))
copy(join(social_path, "install.rdf"), stage_path)

# Now copy in the test provider resources:
for p in PROVIDERS:
	copytree(join(provider_path, p), join(join(stage_path, "testprovider"), p))

# And patch the default services file to install it:
chdir(stage_path)
system("patch -p1 < ../test/testDefaultService.patch")
system("zip -q -r " + xpi_name + " *")
print "Created", xpi_name
