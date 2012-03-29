PYTHON = python

ifeq ($(TOPSRCDIR),)
  export TOPSRCDIR = $(shell pwd)
endif

ifeq ($(MOZ_DIST),)
  MOZ_DIST=../mozilla-central/obj-ff-dbg/dist
endif
MOZ_SDK=$(MOZ_DIST)/sdk/bin

dist_dir=$(TOPSRCDIR)/dist
stage_dir=$(TOPSRCDIR)/stage
xpi_dir=$(TOPSRCDIR)/dist
srcdir = $(TOPSRCDIR)

xpi_name := socialdev.xpi
xpi_files := chrome.manifest modules install.rdf providers content components skin
dep_files := Makefile $(shell find lib -type f | grep -v .DS_Store) $(shell find data -type f | grep -v .DS_Store)

SLINK = ln -sf
ifneq ($(findstring MINGW,$(shell uname -s)),)
  SLINK = cp -r
  export NO_SYMLINK = 1
endif

all: xpi

xpt:
	PYTHONPATH=$(MOZ_SDK) $(PYTHON) $(MOZ_SDK)/typelib.py components/mozISocialAPI.idl --cachedir . -I $(MOZ_DIST)/idl/ -o components/mozISocialAPI.xpt

xpi: $(xpi_dir)/$(xpi_name)

$(xpi_dir):
	mkdir -p $(xpi_dir)

stage_files = $(stage_dir)/install.rdf $(stage_dir)/chrome.manifest $(stage_dir)/modules $(stage_dir)/skin $(stage_dir)/providers $(stage_dir)/content $(stage_dir)/components

$(stage_dir):
	mkdir -p $(stage_dir)

$(stage_dir)/chrome.manifest: $(srcdir)/chrome.manifest
	$(SLINK) $(srcdir)/chrome.manifest $(stage_dir)/chrome.manifest

$(stage_dir)/install.rdf: $(srcdir)/install.rdf
	$(SLINK) $(srcdir)/install.rdf $(stage_dir)/install.rdf

$(stage_dir)/modules: $(srcdir)/modules
	$(SLINK) $(srcdir)/modules $(stage_dir)/modules

$(stage_dir)/content: $(srcdir)/content
	$(SLINK) $(srcdir)/content $(stage_dir)/content

$(stage_dir)/components: $(srcdir)/components
	$(SLINK) $(srcdir)/components $(stage_dir)/components

$(stage_dir)/skin: $(srcdir)/skin
	$(SLINK) $(srcdir)/skin $(stage_dir)/skin

$(stage_dir)/providers: $(srcdir)/providers
	$(SLINK) $(srcdir)/providers $(stage_dir)/providers

$(xpi_dir)/$(xpi_name): $(xpi_dir) $(stage_dir) $(stage_files) $(dep_files)
	rm -f $(xpi_dir)/$(xpi_name)
	cd $(stage_dir) && zip -9r $(xpi_name) $(xpi_files) -x "*/.DS_Store"
	mv $(stage_dir)/$(xpi_name) $(xpi_dir)/$(xpi_name)

clean:
	rm -rf $(stage_dir)
	rm -rf $(dist_dir)

.PHONY: xpi clean
