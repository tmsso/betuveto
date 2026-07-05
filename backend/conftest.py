import os
import sys

# Ensure `import main` works when pytest is invoked from the backend directory.
sys.path.insert(0, os.path.dirname(__file__))
