<script>
  import { createEventDispatcher } from "svelte";
  import Button from "../UI/Button.svelte";
  import TextInput from "../UI/TextInput.svelte";
  export let users;

  let userlist = users.map((user) => user.username);
  const dispatch = createEventDispatcher();

  let username = "";
  let password = "";
  let email = "";

  let creator = sessionStorage.getItem("JWT");

  let usernameBlank = true;
  let usernameError = true;
  let passwordError = true;
  let emailError = false;

  const pwRegex = new RegExp(
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,10}$/
  );
  const emailRegex = new RegExp(
    /^[a-zA-Z0-9.!#$%&’*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)$/
  );

  const emptyFields = () => {
    username = "";
    password = "";
    email = "";
  };

  const handleUsernameChange = (e) => {
    username = e.target.value;
    if (e.target.value == "") {
      usernameBlank = true;
    } else {
      usernameBlank = false;
      if (userlist.includes(e.target.value.trim())) {
        usernameError = true;
      } else {
        usernameError = false;
      }
    }
  };
  const handlePasswordChange = (e) => {
    password = e.target.value;
    if (pwRegex.test(e.target.value)) {
      passwordError = false;
    } else {
      passwordError = true;
    }
  };
  const handleEmailChange = (e) => {
    email = e.target.value;
    if (emailRegex.test(e.target.value)) {
      emailError = false;
    } else {
      if (email == "") {
        emailError = false;
      } else {
        emailError = true;
      }
    }
  };
  const handleSubmitCreateUser = () => {
    if (usernameBlank) {
      alert("Username cant be empty");
    } else if (usernameError) {
      alert("Username in use");
    } else if (passwordError) {
      alert("Invalid Password");
    } else if (emailError) {
      alert("Invalid Email");
    } else {
      const url = "http://localhost:8080/createUser";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          editor: creator,
          username: username,
          password: password,
          email: email,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.Code == 200) {
            emptyFields()
            alert("User created!");
            dispatch("submit");  
          }
        })
        .catch((error) => {
          console.log(error);
        });
    }
  };
  const handleClose = () => {
    dispatch("close");
  };
</script>

<main>
  <form on:submit|preventDefault={handleSubmitCreateUser} class="iCreate">
    <TextInput
      id="username"
      label="Username"
      value={username}
      placeholder="Enter a username"
      on:input={handleUsernameChange}
    />
    <TextInput
      id="password"
      label="Password"
      type="password"
      value={password}
      placeholder="Enter a password"
      on:input={handlePasswordChange}
    />
    <TextInput
      id="email"
      label="Email"
      type="email"
      value={email}
      placeholder="Enter a email"
      on:input={handleEmailChange}
    />
    <div>
      <Button mode="outline" type="submit">Create</Button>
    </div>
    <div>
      <Button mode="outline" on:click={handleClose}>Close</Button>
    </div>
  </form>
</main>

<style>
  .iCreate {
    font-family: sans-serif;
    display: flex;
    align-items: center;
    padding: 0.5rem 2rem;
    width: 100vw;
    justify-content: space-between;
  }

  .iCreate > * {
    margin: 0.5rem;
  }
</style>
