<script>
    let username
    let password
    const handleUserOnChange =(e)=>{
        username = e.target.value
    }
    const handlePassOnChange = (e)=>{
        password = e.target.value
    }
    const onLogin = () =>{
        const url = "http://localhost:8080/authenticate"
    fetch(url,{
      method: "POST",
      body:JSON.stringify({
        username:username,
        password:password
      })
    })
    .then(response => response.json())
    .then(data => {
		if(data.Code != 403){
            sessionStorage.setItem("JWT",data.Message)
            window.location.replace("/dashboard")
        }else{
            alert(data.Message)
        }
    }).catch(error => {
      console.log(error);
    });
    }
</script>
<main>
<div class="homepage">
    <div class="container">
        <div class="iContain">
            <span class="iHeader">Username: </span>
        <input class="iField" type="text" name="username" id="username" on:change={handleUserOnChange} >

        </div>
        <div class="iContain">
            <span class="iHeader">Password: </span>
       <input class="iField" type="password" name="password" id="password" on:change={handlePassOnChange}>

        </div>
        <div class="buttonContain">
            <button class="loginButton" id="login" on:click={onLogin}>Login</button>
        </div>
    </div>
</div>
</main>
<style>
    *{
        box-sizing: border-box;
        margin: 0px;
        padding: 0px;
        font-family: system-ui;
    }
    .homepage{
        width: 100vw;
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .container{
    padding: 50px 100px;
    width:fit-content;
    border-radius: 6px;
    background-color: #fff;
    box-shadow: 0px 4px 0px rgba(0,0,0,0.45);
    border: 2px solid #0f4d92;
}
.iContain{
 position: relative;
 margin: 10px;
 font-family: poppins;
}
.iHeader{
    position: absolute;
    font-size: 12px;
    top: -10px;
    left: 5px;
    background-color: #fff;
    border-radius: 25px;
}
.iField{
    font-size: 16px;
    padding: 5px 10px;
    outline: none;
}
.buttonContain{
    padding: 10px;
}
.loginButton{
    transition: 250ms;
    cursor: pointer;
    width: 100%;
    font-size: 18px;
    padding: 5px 0px;
    color: #fff;
    border: none;
    border-radius: 4px;
    background-color: #0f4d92;
    box-shadow: 0px 2px 0px rgba(0,0,0,0.25);
}
.loginButton:hover{
    background-color: #0072bb;
    box-shadow: 0px 3px 0px rgba(0,0,0,0.45);

}
.loginButton:active{
    box-shadow: 0px 0px 0px rgba(0,0,0,0.45);
    background-color: #000080;
}
</style>