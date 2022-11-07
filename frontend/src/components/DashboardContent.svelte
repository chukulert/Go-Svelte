<script>
  import Task from "../UI/Task.svelte";
  import Button from "../UI/Button.svelte";
  import CreatePlan from "./CreatePlan.svelte";
  import AppForm from "./AppForm.svelte";
  import TaskForma from "./TaskForma.svelte";
  import { onMount, onDestroy } from "svelte";
  import applicationMethods from "../store/application-store";
  import appcolorMethods from "../store/color-store";
  import ScrollingList from "../UI/ScrollingList.svelte";

  let showcreatetaskB = false;
  let showcreateplanB = false;
  let showcreateappB = false;

  let initialtask = [];
  let filteredtask = [];
  let appData = [];
  let apps = [];
  let plans = [];
  let filteredplans = [];
  let appselected = "allapps";
  let planselected = "allplans";
  let createPlan = false;
  let appForm = false;
  let taskForm = false;
  let editapp = false;

  let appPermission;

  let openColor = "#e7d3ec";
  let todoColor = "#e1e157";
  let doingColor = "#e2bb74";
  let doneColor = "#c2e5ae";
  let closeColor = "#f1a99b";

  onMount(async () => {
    // await fetchtask()
    // await Promise.all([fetchtask, fetchApps])
    await fetchApps();
    await fetchplans();
    addAppPermissionData();
    addappplanColor(apps, plans);
    fetchtask();
    createAppPermission();
  });

  const fetchtask = () => {
    return new Promise((resolve, reject) => {
      const url = "http://localhost:8080/getalltask";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          editor: sessionStorage.getItem("JWT"),
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          initialtask = data;
          filteredtask = initialtask;
          resolve();
        })
        .catch((err) => {
          console.log(err);
        });
    });
  };

  const fetchtaskbyapp = () => {
    return new Promise((resolve, reject) => {
      const url = "http://localhost:8080/getalltaskbyacronym";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          editor: sessionStorage.getItem("JWT"),
          taskacronym: appselected,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          filteredtask = data;
        })
        .catch((err) => {
          console.log(err);
        });
    });
  };

  const fetchplansbyapp = () => {
    return new Promise((resolve, reject) => {
      const url = "http://localhost:8080/getplanbyapp";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          editor: sessionStorage.getItem("JWT"),
          acronym: appselected,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          filteredplans = data.map((e) => e.planname);
          resolve();
        })
        .catch((err) => {
          console.log(err);
        });
    });
  };

  const fetchtaskbyappplan = () => {
    return new Promise((resolve, reject) => {
      const url = "http://localhost:8080/getalltaskbyacronymnplan";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          editor: sessionStorage.getItem("JWT"),
          taskacronym: appselected,
          taskplan: planselected,
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          filteredtask = data;
          resolve();
        })
        .catch((err) => {
          console.log(err);
        });
    });
  };

  function addappplanColor(apps, plans) {
    for (let i = 0; i < apps.length; i++) {
      appcolorMethods.addAppColors(apps[i]);
    }

    for (let i = 0; i < plans.length; i++) {
      appcolorMethods.addPlanColors(plans[i]);
    }
  }

  const unsubscribeAppPermission = applicationMethods.subscribe(
    (application) => (appPermission = application)
  );

  function addAppPermissionData() {
    for (let i = 0; i < appData.length; i++) {
      let app = {};

      app["appname"] = appData[i]["appacronym"];
      app["permitCreate"] = appData[i]["permitcreate"];
      app["permitOpen"] = appData[i]["permitopen"];
      app["permitTodo"] = appData[i]["permittodo"];
      app["permitDoing"] = appData[i]["permitdoing"];
      app["permitDone"] = appData[i]["permitdone"];

      applicationMethods.addApplication(app);
    }
  }

  onDestroy(() => {
    unsubscribeAppPermission();
  });

  const fetchApps = () => {
    return new Promise((resolve, reject) => {
      const url = "http://localhost:8080/fetchapps";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          editor: sessionStorage.getItem("JWT"),
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          appData = data;
          apps = data.map((app) => app.appacronym);
          resolve();
        })
        .catch((err) => {
          console.log(err);
        });
    });
  };

  const fetchplans = () => {
    return new Promise((resolve, reject) => {
      const url = "http://localhost:8080/getallplan";
      fetch(url, {
        method: "POST",
        body: JSON.stringify({
          editor: sessionStorage.getItem("JWT"),
        }),
      })
        .then((response) => response.json())
        .then((data) => {
          plans = data.map((plan) => plan.planname);
          resolve();
        })
        .catch((err) => {
          console.log(err);
        });
    });
  };

  const showCreatePlan = () => {
    createPlan = true;
  };
  const closeCreatePlan = () => {
    createPlan = false;
  };

  const getAllUpdatedTask = async () => {
    if (appselected === "allapps") {
      fetchtask();
    } else if (appselected !== "allapps" && planselected === "allplans") {
      fetchtaskbyapp();
    } else if (planselected !== "allplans" && appselected !== "allapps") {
      fetchtaskbyappplan();
    }
  };
  const toggleAppForm = (e) => {
    if (e.currentTarget) {
      if (e.currentTarget.id === "editapp") {
        editapp = true;
      } else {
        editapp = false;
      }
    }

    appForm = !appForm;
  };
  const toggleTaskForm = () => {
    taskForm = !taskForm;
  };

  const filterTaskByApp = async (event) => {
    appselected = event.detail;

    if (appselected === "allapps") {
      await fetchtask();
      // filteredtask = initialtask
    } else if (appselected !== "allapps") {
      await fetchtask();
      filteredtask = initialtask.filter((e) => e.taskacronym === appselected);
      await fetchplansbyapp();
      planselected = "allplans";
      createTaskPermission();
      createPlanPermission();
    }
  };

  const filterTaskByAppPlan = async (event) => {
    planselected = event.detail;
    if (planselected === "allplans") {
      await fetchtaskbyapp();
    } else {
      await fetchtaskbyappplan();
      filteredtask = filteredtask.filter((e) => e.taskplan === planselected);
    }
  };

  const checkGroup = (token, group, type) => {
    const url = "http://localhost:8080/authorize";
    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        token: token,
        group: group,
      }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.Message === "true") {
          if (type === "task") {
            showcreatetaskB = true;
          } else if (type === "plan") {
            showcreateplanB = true;
          } else if (type === "app") {
            showcreateappB = true;
          }
        } else {
          if (type === "task") {
            showcreatetaskB = false;
          } else if (type === "plan") {
            showcreateplanB = false;
          } else if (type === "app") {
            showcreateplanB = false;
          }
        }
      })
      .catch((error) => {
        console.log(error);
      });
  };

  const createTaskPermission = () => {
    if (
      $applicationMethods.filter((e) => e.appname === appselected).length === 0
    ) {
      showcreatetaskB = false;
    } else {
      checkGroup(
        sessionStorage.getItem("JWT"),
        $applicationMethods.filter((e) => e.appname === appselected)[0][
          "permitCreate"
        ],
        "task"
      );
    }
  };

  const createPlanPermission = () => {
    if (
      $applicationMethods.filter((e) => e.appname === appselected).length === 0
    ) {
      showcreateplanB = false;
    } else {
      checkGroup(
        sessionStorage.getItem("JWT"),
        $applicationMethods.filter((e) => e.appname === appselected)[0][
          "permitOpen"
        ],
        "plan"
      );
    }
  };

  const createAppPermission = () => {
    checkGroup(sessionStorage.getItem("JWT"), "configmanager", "app");
  };

  const updateApp = async() => {
    await fetchApps();
    addAppPermissionData();
    createTaskPermission();
    createPlanPermission();
  }
</script>

<main class="container">
  <div class="left-sidebar">
    <div class="left-section">
      <p>Applications</p>

      <div class="button-center">
        {#if showcreateappB}
          <Button id="newapp" size="sm" mode="outline" on:click={toggleAppForm}
            >New App</Button
          >
        {/if}
        {#if showcreateappB && appselected !== "allapps"}
          <Button id="editapp" size="sm" mode="outline" on:click={toggleAppForm}
            >Edit App</Button
          >
        {/if}
      </div>
      <ScrollingList
        arr={["allapps", ...apps]}
        on:selected={filterTaskByApp}
        type="application"
        {appselected}
        {planselected}
      />
    </div>
    {#if appselected != "allapps"}
      <div class="left-section">
        <p>Plans</p>

        {#if showcreateplanB}
          <div class="button-center">
            <Button size="sm" mode="outline" on:click={showCreatePlan}>
              New Plan
            </Button>
          </div>
        {/if}

        <ScrollingList
          arr={["allplans", ...filteredplans]}
          on:selected={filterTaskByAppPlan}
          type="plan"
        />
      </div>
    {/if}
  </div>

  {#if appForm}
    <AppForm plans={["allplans", ...plans]} on:update={updateApp} on:close={toggleAppForm} {appselected} {appData} {editapp} />
  {/if}

  {#if taskForm}
    <TaskForma state="permitCreate" {appselected} on:update={getAllUpdatedTask} on:close={toggleTaskForm} />
  {/if}

  {#if createPlan}
    <CreatePlan apps={["allapps", ...apps]} on:update={async() => await fetchplansbyapp()} on:close={closeCreatePlan} {appselected} />
  {/if}

  <div class="right">
    <div class="state">
      <div class="header" style="background-color: {openColor}">
        <p>Open</p>
      </div>
      {#if showcreatetaskB && appselected !== "allapps"}
      <div class="button-task">
        <Button on:click={toggleTaskForm}>Create Task</Button>
      </div>
      {/if}
      <div class="task-container">
      {#each filteredtask as t}
        {#if t.taskstate == "open"}
          <Task
          key={t.taskid}
            {filteredplans}
            state="permitOpen"
            task={t}
            stateColor={openColor}
            on:update={getAllUpdatedTask}
          />
        {/if}
      {/each}
    </div>
    </div>

    <div class="state">
      <div class="header" style="background-color: {todoColor}">
        <p>To Do</p>
      </div>
      <div class="task-container">
      {#each filteredtask as t}
        {#if t.taskstate == "todo"}
          <Task
          key={t.taskid}
            {filteredplans}
            state="permitTodo"
            task={t}
            stateColor={todoColor}
            on:update={getAllUpdatedTask}
          />
        {/if}
      {/each}
      </div>
    </div>

    <div class="state">
      <div class="header" style="background-color: {doingColor}">
        <p>Doing</p>
      </div>
      <div class="task-container">
      {#each filteredtask as t}
        {#if t.taskstate == "doing"}
          <Task
            key={t.taskid}
            {filteredplans}
            state="permitDoing"
            task={t}
            stateColor={doingColor}
            on:update={getAllUpdatedTask}
          />
        {/if}
      {/each}
      </div>
    </div>

    <div class="state">
      <div class="header" style="background-color: {doneColor}">
        <p>Done</p>
      </div>
      <div class="task-container">
      {#each filteredtask as t}
        {#if t.taskstate == "done"}
          <Task
          key={t.taskid}
            {filteredplans}
            state="permitDone"
            task={t}
            stateColor={doneColor}
            on:update={getAllUpdatedTask}
          />
        {/if}
      {/each}
      </div>
    </div>

    <div class="state">
      <div class="header" style="background-color: {closeColor}">
        <p>Close</p>
      </div>
      <div class="task-container">
      {#each filteredtask as t}
        {#if t.taskstate == "closed"}
          <Task
          key={t.taskid}
            {filteredplans}
            task={t}
            stateColor={closeColor}
            on:update={getAllUpdatedTask}
          />
        {/if}
      {/each}
      </div>
    </div>
  </div>
</main>

<style>
  .container {
    display: flex;
    width: 100vw;
    min-height: 91vh;
    overflow-y: hidden;
    overflow-x: hidden;
    font-family: sans-serif;
    font-size: 0.8rem;
  }

  .left-sidebar {
    display: flex;
    flex-direction: column;
    background-color: #5e91cb;
    width: 15vw;
    height: 91vh;
  }

  .left-section {
    padding: 0.5rem;
    margin: 0.5rem;
    border-radius: 8px;
    border: 3px solid var(--main-color);
    height: 45%;
    background-color: #fff;
    margin-bottom: 15px;
    box-shadow: 0px 3px 8px rgba(0, 0, 0, 0.45);
    overflow: auto;
  }

  .left-section p {
    text-align: center;
    margin-bottom: 0.4rem;
    font-weight: bold;
  }

  .right {
    display: flex;
    width: 85vw;
    height: 91vh;
  }
  .state {
    border-right: 2px solid #cecece;
    height: 100%;
    width: 20%;
    padding: 10px;
  }

  .header {
    width: 100%;
    height: 5%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid #cecece;
    border-radius: 15px;
    font-family: sans-serif;
    box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.45);
    margin-bottom: 15px;
  }
  .header p {
    font-size: 22px;
    font-weight: 500;
  }
  .button-center {
    text-align: center;
  }
  .button-task {
    margin: 1rem;
    text-align: center;
  }

  .task-container {
    overflow-y: scroll;
    /* background-color: red;  */
    height: 78vh;
    padding-right: 10px;
    /* position: absolute; */
  }

  /* width */
::-webkit-scrollbar {
  width: 6px;
 padding: 2px;
}

/* Track */
::-webkit-scrollbar-track {
  /* box-shadow: inset 0 0 5px grey; */
  border-radius: 10px;
 
}

/* Handle */
::-webkit-scrollbar-thumb {
  background: grey;
  border-radius: 10px;
  height: 10px;
}

  /* .list {
    font-weight: normal;
    overflow-y: auto;
    border: 1px solid #444;
    margin-top: 10px;
    
  }
  .list-item {
    border: 1px solid rgb(5, 5, 5);
    cursor: pointer;
    color: black;
  } */

  /* .left-top div{
    display: flex;
    margin: 2px;
    margin-top: 44px;
}
#createtaskbtn{
    display: flex;
    justify-content: center;
    height: 50px;
    margin-top: 20px;
}
.button-plan{
    text-align: center;
} */
</style>
