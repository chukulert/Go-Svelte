package controllers

import (
	"database/sql"
	"encoding/json"
	"myModule/src/entities"
	"myModule/src/models"
	subController "myModule/src/sub"
	"net/http"
	"strings"
)

// JunHe - createTask controller
func CreateTask(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	taskModel := models.TASKDB{
		Db: db,
	}
	task := entities.Task{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 501)
		return
	}
	userModel := models.USERDB{
		Db: db,
	}

	if len(task.Group) == 0 || len(task.Acronym) == 0 || len(task.TaskName) == 0 {
		subController.WriteJsonMsg(w, "Field cannot be empty", false, 406)
		return
	} else {
		if userModel.CheckGroup(username, task.Group) {
			res, err := taskModel.CreateTask(strings.TrimSpace(task.TaskName), task.Des, task.AddedNote, task.Acronym, username)
			if err != nil {
				subController.WriteJsonMsg(w, "Internal Server Error", false, 502)
				return
			} else {
				if res {
					subController.WriteJsonMsg(w, "Task created success", true, 200)
				} else {
					subController.WriteJsonMsg(w, "App name does not exist or Task name exist", false, 407)
				}
			}
		} else {
			subController.WriteJsonMsg(w, "User have no right to create new task", false, 408)
		}
	}
}

// JunHe get All task controller
func FetchAllTask(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	taskModel := models.TASKDB{
		Db: db,
	}
	task := entities.Task{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
		return
	}
	result, err := taskModel.GetAllTask()
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
	} else {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

// JunHe get All task by acronym
func FetchAllTaskByAcronym(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	taskModel := models.TASKDB{
		Db: db,
	}
	task := entities.Task{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
		return
	}
	result, err := taskModel.GetTaskByApp(task.Acronym)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
	} else {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

// JunHe get task by acronym and plan
func FetchAllTaskByAcronymNPlan(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	taskModel := models.TASKDB{
		Db: db,
	}
	task := entities.Task{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
		return
	}
	result, err := taskModel.GetTaskByAppNPlan(task.Acronym, task.Plan)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
	} else {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}
}

// Glenn
// # move task from one state to another
// # transitionState( user, state, direction, token, group) -> (string, string, int, string, string)
// # user -> username
// # state -> current task state
// # direction -> move state left or right, using 0 or 1 respectively
// # token -> JWT token from sessionstorage upon login
// # group -> To use current application and specific permit selected, and pass a single group/ string of groups
// etc. if moving tasks in todo state, pass in string of group values in app.permittodo to group parameter
func StateTransition(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	task := entities.TaskTransition{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
	}
	id, state, direction, group, oldTasknote := task.Id, task.State, task.Direction, task.Group, task.Note
	taskModel := models.TASKDB{
		Db: db,
	}
	//check if creating is allowed
	//check for JWT and check for lead group
	userModel := models.USERDB{
		Db: db,
	}
	// if not in group -> no permission
	if !(userModel.CheckGroup(username, group)) {
		subController.WriteJsonMsg(w, "User have no right to edit this task", false, 408)
		return
	}
	message, err := taskModel.TransitionState(id, state, direction, oldTasknote, username)
	 if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
	} else {
		subController.WriteJsonMsg(w, message, true, 200)
	}
}

// GIN UPDATE FIELD IN TASK TABLE
func EditTask(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	taskModel := models.TASKDB{
		Db: db,
	}
	userModel := models.USERDB{
		Db: db,
	}
	task := entities.Task{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
		return
	}
	auth := userModel.CheckGroup(username, task.Group)
	if auth {
		_, err := taskModel.EditTask(task.Id, task.Des, task.Field, username, task.State, task.OldDes, task.Note)
		if err != nil {
			subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
			return
		}
		subController.WriteJsonMsg(w, "Update success", true, 200)
		return
	} else {
		subController.WriteJsonMsg(w, "User have no right to edit task", false, 408)
		return
	}
}

func InsertTaskNote(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
	taskModel := models.TASKDB{
		Db: db,
	}
	task := entities.Task{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
		return
	}
	userModel := models.USERDB{
		Db: db,
	}
	if userModel.CheckGroup(username, task.Group) {
		res, err := taskModel.InsertTaskNote(task.Id, task.State, task.Note, task.OldDes, task.Des, task.AddedNote, username)
		if err != nil {
			subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
			return
		} else {
			if res {
				subController.WriteJsonMsg(w, "Task note added successfully", true, 200)
			}
		}
	} else {
		subController.WriteJsonMsg(w, "User have no right to insert new task note", false, 408)
	}
}
// GIN EMAIL
func Triggermail(w http.ResponseWriter, r *http.Request, username string, db *sql.DB, body []byte) {
taskModel := models.TASKDB{
		Db: db,
	}
	task := entities.Task{}
	err := json.Unmarshal(body, &task)
	if err != nil {
		subController.WriteJsonMsg(w, "Internal Server Error", false, 500)
		return
	}
	userModel := models.USERDB{
		Db: db,
	}
	if userModel.CheckGroup(username, task.Group) {

		//send mail

		res, err := taskModel.SendEmail(task.Id)
		if err != nil {
			subController.WriteJsonMsg(w, "Email err", false, 500)
			return
		}
		subController.WriteJsonMsg(w, "mail sent", res, 200)
		
	} else {
		subController.WriteJsonMsg(w, "User have no right to send mail", false, 408)
	}
}