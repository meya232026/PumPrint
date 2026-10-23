// Site settings you can change without touching the code.
// Name, contract address and social links live here.
window.PUMPRINT_CONFIG = {
  // Drawn in cut-out letters in the header and the footer.
  name: 'PUMPRINT',

  // Your token's contract address. While empty, the header shows "Soon…pump"
  // and the copy button says the address is not live yet.
  contractAddress: '',

  // Social buttons in the header and footer. Leave a link empty to keep the
  // button without a link (it shows "Link coming soon" when clicked).
  links: {
    pump: '',
    x: '',
    telegram: '',
    github: '',
  },

  // Where the tools get their data:
  //   'auto'   use this site's server when it answers, otherwise run in the
  //            browser (Moth reads pump.fun directly; Kolibri shows sample callers)
  //   'demo'   always use made-up sample data
  dataMode: 'auto',
};
