<script>
  import Button from "../UI/Button.svelte";
  import TextInput from "../UI/TextInput.svelte";

  let password = "";
  let email = "";
  let passworderrormsg = "";
  let emailerrormsg = "";
  // let passwordValid = false;
  // let emailValid = false;

  // $: passwordValid = validatePassword(password)
  // $: emailValid = validateEmail(email)

  function validatePassword(password) {
    var passwordRegEx =
      /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+])[A-Za-z\d!@#$%^&*()_+]{8,10}/;
    return passwordRegEx.test(String(password).toLowerCase());
  }

  function handlePasswordSubmission() {
    let isValidPassword = validatePassword(password);
    if (isValidPassword) {
      passworderrormsg = "";
      const url = "http://localhost:8080/updateuserpassword";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          token: sessionStorage.getItem("JWT"),
          password: password,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          alert(data.Message);
          console.log(data);
        })
        .catch((error) => {
          console.log(error);
        });
    } else {
      passworderrormsg = "Invalid password";
      alert(passworderrormsg)
    }
  }

  function validateEmail(email) {
    var emailRegEx =
      /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return emailRegEx.test(String(email).toLowerCase());
  }

  function handleEmailSubmission() {
    let isValidEmail = validateEmail(email);
    if (isValidEmail) {
      emailerrormsg = "";
      const url = "http://localhost:8080/updateuseremail";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          token: sessionStorage.getItem("JWT"),
          email: email,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          alert(data.Message);
          console.log(data);
        })
        .catch((error) => {
          console.log(error);
        });
    } else {
      emailerrormsg = "Invalid email";
      alert(emailerrormsg);
    }
  }
</script>

<main class="page-container">
  <div class="section">
    <h2>Edit Email</h2>

    <div class="input-wrapper">
      <TextInput
        id="email"
        type="email"
        label="New Email"
        placeholder="Enter new email"
        value={email}
        on:input={(e) => (email = e.target.value)}
      />
      <div class="submit-btn">
        <Button on:click={handleEmailSubmission}>Submit</Button>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Edit Password</h2>

    <div class="input-wrapper">
      <TextInput
        id="password"
        type="password"
        label="New Password"
        placeholder="Enter new password"
        value={password}
        on:input={(e) => (password = e.target.value)}
      />
      <div class="submit-btn">
        <Button on:click={handlePasswordSubmission}>Submit</Button>
      </div>
    </div>
  </div>
</main>

<style>
  main {
    font-family: sans-serif;
    width: 100%;
    display: flex;
    justify-content: center;
  }

  .input-wrapper {
    font-family: sans-serif;
    display: flex;
    justify-content: center;
    column-gap: 1rem;
    width: 100%;
  }

  h2 {
    text-align: center;
  }
  .submit-btn {
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
  }

  .section {
    margin: 1rem 0;
  }
</style>
