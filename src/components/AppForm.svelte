<script>
  import { onMount, createEventDispatcher } from "svelte";
  import Button from "../UI/Button.svelte";
  import Modal from "../UI/Modal.svelte";
  import TextInput from "../UI/TextInput.svelte";
  import appcolorMethods from "../store/color-store";

  export let grouplist = [];
  export let appselected = "";
  export let appData = [];
  export let editapp;
  export let plans;
  
  let appacronym = "";
  let description = "";
  let rnumber = "";
  let startdate = "";
  let enddate = "";
  let permitcreate = "";
  let permitdoing = "";
  let permitdone = "";
  let permitopen = "";
  let permittodo = "";

  const dispatch = createEventDispatcher()

  onMount(() => {
    getAllGroups();
    if (editapp) {
      const app = appData.find((app) => app.appacronym === appselected);
      appacronym = app.appacronym;
      description = app.description;
      rnumber = app.rnumber;
      startdate = app.startdate;
      enddate = app.enddate;
      permitcreate = app.permitcreate;
      permitdoing = app.permitdoing;
      permitdone = app.permitdone;
      permitopen = app.permitopen;
      permittodo = app.permittodo;
    }
  });

  async function getAllGroups() {
    const url = "http://localhost:8080/fetchgroups";
    fetch(url)
      .then((response) => response.json())
      .then((data) => {
        const dataArr = data.map((grp) => grp.groupname);
        grouplist = dataArr;
      })
      .catch((error) => {
        console.log(error);
      });
  }
  const createApp = () => {
    const url = "http://localhost:8080/createapp";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          AppAcronym: appacronym,
          Description: description,
          Rnumber: rnumber,
          StartDate: startdate,
          EndDate: enddate,
          PermitCreate: permitcreate,
          PermitDoing: permitdoing,
          PermitDone: permitdone,
          PermitOpen: permitopen,
          PermitToDo: permittodo,
          Editor: sessionStorage.getItem("JWT"),
          Group: "configmanager",
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.Code != 200) {
            alert(data.Message);
          } else {
            appcolorMethods.addAppColors(appacronym)
            dispatch("update")
            alert("Successfully created application");
            emptyFields();
            // window.location.reload(false);
          }
        })
        .catch((error) => {
          console.log(error);
        });
  }

  const editApp = () => {
    const url = "http://localhost:8080/editapp";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          AppAcronym: appacronym,
          PermitCreate: permitcreate,
          PermitDoing: permitdoing,
          PermitDone: permitdone,
          PermitOpen: permitopen,
          PermitToDo: permittodo,
          Editor: sessionStorage.getItem("JWT"),
          Group: "configmanager",
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.Code != 200) {
            alert(data.Message);
          } else {
            dispatch("update")
            alert("Application successfully updated");
          }
        })
        .catch((error) => {
          console.log(error);
        });
  }

  const submitHandler = () => {
    if (appacronym == "") {
      alert("App Acronym can't be empty");
    } else if (plans.includes(appacronym)) {
      alert("App name not allowed, please select a different app name")
    } else if (appacronym == "allapps") {
      alert("Please use another app name")
    }  else if (startdate == "") {
      alert("Start date can't be empty");
    } else if (startdate > enddate) {
      alert("End date can't be empty");
    } else if (startdate > enddate) {
      alert("Start date cannot before before the End date");
    } else if (rnumber == "") {
      alert("App running number is required");
    } else {
    editapp ? editApp() : createApp()
    }
  };

  const emptyFields = () => {
    appacronym = "";
    description = "";
    rnumber = "";
    startdate = "";
    enddate = "";
    permitcreate = "";
    permitdoing = "";
    permitdone = "";
    permitopen = "";
    permittodo = "";
  };
</script>

<Modal
  title={editapp ? `Edit ${appselected}` : "Create Application"}
  on:close
  on:submit
>
  <form class="app-form" on:submit|preventDefault={submitHandler}>
    <div class="form-section">
      <TextInput
        id="name"
        label="Application Name*"
        placeholder="Enter name"
        value={appacronym}
        on:input={(e) => (appacronym = e.target.value)}
        disable={editapp}
      />

      <TextInput
        id="startdate"
        name="startdate"
        type="date"
        label="Start Date*"
        value={startdate}
        on:input={(e) => (startdate = e.target.value)}
        disable={editapp}
      />
      <TextInput
        id="enddate"
        name="enddate"
        type="date"
        label="End Date*"
        value={enddate}
        on:input={(e) => (enddate = e.target.value)}
        disable={editapp}
      />
      <TextInput
        id="runningnumber"
        type="number"
        label="Running Number*"
        placeholder="Enter running number"
        value={rnumber}
        on:input={(e) => (rnumber = e.target.value)}
        disable={editapp}
      />
      <TextInput
        label="Create:"
        {grouplist}
        controlType="select"
        value={permitcreate}
        on:input={(e) => (permitcreate = e.target.value)}
      />
      <TextInput
        label="Open:"
        {grouplist}
        controlType="select"
        value={permitopen}
        on:input={(e) => (permitopen = e.target.value)}
      />
      <TextInput
        label="To-Do:"
        {grouplist}
        controlType="select"
        value={permittodo}
        on:input={(e) => (permittodo = e.target.value)}
      />
      
    </div>
   
    <div class="form-section">
      <textarea name="description" id="name" on:input={(e) => (description = e.target.value)} disable={editapp}    value={description}   placeholder="Enter description"></textarea>
      <TextInput
      label="Doing:"
      {grouplist}
      controlType="select"
      value={permitdoing}
      on:input={(e) => (permitdoing = e.target.value)}
    />
    <TextInput
      label="Done:"
      {grouplist}
      controlType="select"
      value={permitdone}
      on:input={(e) => (permitdone = e.target.value)}
    />
      <div class="btn-container ">
        <Button type="submit" mode="outline">Submit</Button>
      </div>
    </div>
  </form>
</Modal>

<style>
  .app-form {
    display: flex;
    justify-content: space-around;
  }
  .form-section {
    width: 40%;
  }
  .btn-container {
    right: 1rem;
    position: absolute;
    display: flex;
    justify-content: flex-end;
  }
  #name{
    max-width: 100%;
    min-width: 100%;
    min-height: 45vh;
    max-height: 45vh;
    padding: 5px;
  }
</style>
