"""Reading XBRL instances: the parser, and (in later modules) the element maps and the read.

The versions below say what a revision was read under. A change to the parser or to a sum bumps
``XBRL_PARSER_VERSION``, a change to an element map bumps ``XBRL_MAP_VERSION``, a change to the text
block reader bumps ``XBRL_TEXT_VERSION`` and a change to the ``xbrl_in_pdf`` check bumps
``XBRL_PDF_CHECK_VERSION``. Each ships with its evaluation report under ``docs/eval/``.
"""

XBRL_PARSER_VERSION = "1"
XBRL_MAP_VERSION = "1"
XBRL_TEXT_VERSION = "1"
XBRL_PDF_CHECK_VERSION = 1

# The XBRL 2.1 instance namespace: the root element, contexts and units live here.
INSTANCE_NS = "http://www.xbrl.org/2003/instance"
