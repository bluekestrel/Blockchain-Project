import "./index.scss";

// Looks like parcel's node emulation includes the crypto packages we need to compute a digital
// signature client-side
const EC = require('elliptic').ec;
const crypto = require('crypto');
const SHA256 = require('crypto-js/sha256');
const ec = new EC('secp256k1');
const server = "http://localhost:3042";

document.getElementById("exchange-address").addEventListener('input', ({ target: {value} }) => {
  if(value === "") {
    document.getElementById("balance").innerHTML = 0;
    return;
  }

  fetch(`${server}/balance/${value}`).then((response) => {
    return response.json();
  }).then(({ balance }) => {
    document.getElementById("balance").innerHTML = balance;
  });
});

document.getElementById("transfer-amount").addEventListener('click', () => {
  const sender = document.getElementById("exchange-address").value;
  const amount = document.getElementById("send-amount").value;
  const recipient = document.getElementById("recipient").value;
  const privkey = document.getElementById("private-key").value;

  // Create a digital signature to include with the other data to be sent to the server
  const key = ec.keyFromPrivate(privkey);
  let nonce = crypto.randomBytes(16).toString('hex');

  // We'll use the sender + amount + recipient + a nonce as the message to hash
  let message = JSON.stringify({
    sender, amount, recipient, nonce
  });
  let message_hash = SHA256(message).toString();

  // Sign the hash and save the r and s values to an object
  let signature = key.sign(message_hash);
  let sign_obj = {'signature': {
    r: signature.r.toString(16),
    s: signature.s.toString(16)
  }};

  const body = JSON.stringify({
    sender, amount, recipient, message_hash, sign_obj
  });

  const request = new Request(`${server}/send`, { method: 'POST', body });

  fetch(request, { headers: { 'Content-Type': 'application/json' }}).then(response => {
    return response.json();
  }).then(({ balance }) => {
    document.getElementById("balance").innerHTML = balance;
  });
});
