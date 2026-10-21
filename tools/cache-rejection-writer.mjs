/** Retired finite operator. All new resolutions use the shared protocol. */
const help=process.argv.includes('--help');
const message='Use the adopted frozen bundle: node cleaned-preparation-writer.mjs --help (or cleaned-preparation-observer.mjs --help). This finite entry point cannot write or observe a new resolution.';
if(help)console.log(message);else{console.error(message);process.exitCode=1;}
