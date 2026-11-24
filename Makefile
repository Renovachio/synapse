# synapse: install, remove and check the plugin. The work is in scripts/synapse.sh.
# Presets, optional: SCOPE=local|user FROM=here|github SYNAPSE_YES=1 (no confirmation on remove)

SYNAPSE := sh scripts/synapse.sh
.DEFAULT_GOAL := help
export SCOPE FROM SYNAPSE_YES

.PHONY: help setup remove status check
help:
	@$(SYNAPSE) help
setup remove status check:
	@$(SYNAPSE) $@
