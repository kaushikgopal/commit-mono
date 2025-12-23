.DEFAULT_GOAL := default

CONFIG := config.yaml
OUT_DIR := fonts

SUFFIX := $(shell awk -F': *' '/^suffix:/{print $$2; exit}' $(CONFIG))
WEIGHT_MIN := $(shell awk -F': *' '/^weight_min:/{print $$2; exit}' $(CONFIG))
WEIGHT_MAX := $(shell awk -F': *' '/^weight_max:/{print $$2; exit}' $(CONFIG))
WEIGHT_STEP := $(shell awk -F': *' '/^weight_step:/{print $$2; exit}' $(CONFIG))
LETTER_SPACING := $(shell awk -F': *' '/^letter_spacing:/{print $$2; exit}' $(CONFIG))
LINE_HEIGHT := $(shell awk -F': *' '/^line_height:/{print $$2; exit}' $(CONFIG))

FEATURES := $(shell awk '/^features:/{in_block=1;next} /^[^[:space:]]/{in_block=0} in_block && /^ *-/{sub(/^ *- */,""); print}' $(CONFIG) | paste -sd, -)
ALTERNATES := $(shell awk '/^alternates:/{in_block=1;next} /^[^[:space:]]/{in_block=0} in_block && /^ *-/{sub(/^ *- */,""); print}' $(CONFIG) | paste -sd, -)

default: uninstall build install ## Remove old, build, install (macOS)

help: 	## List available commands
	@awk -F'##' '/^[a-zA-Z0-9_-]+:.*##/ {gsub(/:.*/, ":\t\t", $$1); printf "%s%s\n", $$1, $$2}' $(MAKEFILE_LIST) | \
		awk 'NR%2==1 {print "\033[0m" $$0} NR%2==0 {print "\033[2m" $$0}'
	@echo "\033[0m"

build: 	## Generate customized Commit Mono OTFs into `fonts/`
	@rm -rf $(OUT_DIR)
	@mkdir -p $(OUT_DIR)
	@SUFFIX="$(SUFFIX)" \
		WEIGHT_MIN="$(WEIGHT_MIN)" \
		WEIGHT_MAX="$(WEIGHT_MAX)" \
		WEIGHT_STEP="$(WEIGHT_STEP)" \
		LETTER_SPACING="$(LETTER_SPACING)" \
		LINE_HEIGHT="$(LINE_HEIGHT)" \
		FEATURES="$(FEATURES)" \
		ALTERNATES="$(ALTERNATES)" \
		OUT_DIR="$(OUT_DIR)" \
		node scripts/build_custom_fonts.cjs

install: build ## Install generated fonts to ~/Library/Fonts (macOS)
	@if [ -z "$(SUFFIX)" ]; then echo "ERROR: config.yaml must set non-empty suffix to install."; exit 2; fi
	@echo "Installing CommitMono-$(SUFFIX) fonts to ~/Library/Fonts/ ..."
	@cp $(OUT_DIR)/CommitMono-$(SUFFIX)-*.otf ~/Library/Fonts/

uninstall: ## Remove installed CommitMono-<suffix> fonts from ~/Library/Fonts (macOS)
	@if [ -z "$(SUFFIX)" ]; then echo "ERROR: config.yaml must set non-empty suffix to uninstall."; exit 2; fi
	@echo "Removing CommitMono-$(SUFFIX) fonts from ~/Library/Fonts/ ..."
	@rm -f ~/Library/Fonts/CommitMono-$(SUFFIX)-*.otf 2>/dev/null || true

clean: ## Remove generated `fonts/` output directory
	@rm -rf $(OUT_DIR)

.PHONY: default help build install uninstall clean
