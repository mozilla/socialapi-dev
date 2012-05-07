#!/bin/sh

if (test ! "$FIREFOX_BIN"); then
	echo "Please define FIREFOX_BIN with the path to Firefox";
	exit;
fi

$FIREFOX_BIN -CreateProfile "soc_test `pwd`"

echo "Sorry, this isn't done yet.  You should now:\n1. Create an 'extensions' directory in the profile directory just created\n2. Copy the .xpi produced by build.py into that directory\n3. Run FIREFOX_BIN with -p test_soc"