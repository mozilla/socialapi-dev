ifeq ($(TOPSRCDIR),)
  export TOPSRCDIR = $(shell pwd)
endif

dist_dir=$(TOPSRCDIR)/dist
stage_dir=$(TOPSRCDIR)/stage
xpi_dir=$(TOPSRCDIR)/dist
srcdir = $(TOPSRCDIR)

xpi_name := socialdev.xpi
xpi_files := bootstrap.js data lib install.rdf
dep_files := Makefile $(shell find lib -type f | grep -v .DS_Store) $(shell find data -type f | grep -v .DS_Store)

SLINK = ln -sf
ifneq ($(findstring MINGW,$(shell uname -s)),)
  SLINK = cp -r
  export NO_SYMLINK = 1
endif

all: xpi

xpi: $(xpi_dir)/$(xpi_name)

$(xpi_dir):
	mkdir -p $(xpi_dir)

stage_files = $(stage_dir)/install.rdf $(stage_dir)/bootstrap.js $(stage_dir)/lib $(stage_dir)/data

$(stage_dir):
	mkdir -p $(stage_dir)

$(stage_dir)/bootstrap.js: $(srcdir)/bootstrap.js
	$(SLINK) $(srcdir)/bootstrap.js $(stage_dir)/bootstrap.js

$(stage_dir)/install.rdf: $(srcdir)/install.rdf
	$(SLINK) $(srcdir)/install.rdf $(stage_dir)/install.rdf

$(stage_dir)/lib: $(srcdir)/lib
	$(SLINK) $(srcdir)/lib $(stage_dir)/lib

$(stage_dir)/data: $(srcdir)/data
	$(SLINK) $(srcdir)/data $(stage_dir)/data

$(xpi_dir)/$(xpi_name): $(xpi_dir) $(stage_dir) $(stage_files) $(dep_files)
	rm -f $(xpi_dir)/$(xpi_name)
	cd $(stage_dir) && zip -9r $(xpi_name) $(xpi_files) -x "*/.DS_Store"
	mv $(stage_dir)/$(xpi_name) $(xpi_dir)/$(xpi_name)

clean:
	rm -rf $(stage_dir)
	rm -rf $(dist_dir)

.PHONY: xpi clean
