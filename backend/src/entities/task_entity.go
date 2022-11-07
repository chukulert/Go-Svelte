package entities

type Task struct {
	TaskName   string `json:"taskname"`
	Des        string `json:"taskdes"`
	OldDes     string `json:"olddes"`
	Note       string `json:"tasknote"`
	AddedNote  string `json:"addedtasknote"`
	Id         string `json:"taskid"`
	Plan       string `json:"taskplan"`
	Acronym    string `json:"taskacronym"`
	State      string `json:"taskstate"`
	Creator    string `json:"taskcreator"`
	Owner      string `json:"taskowner"`
	CreateDate string `json:"createdate"`
	Editor     string `json:"editor"`
	Field      string `json:"field"`
	Group      string `json:"group"` //permit needed
}

type TaskTransition struct {
	Id        string `json:"taskid"`
	State     string `json:"taskstate"`
	Direction int    `json:"direction"`
	Editor    string `json:"editor"`
	Group     string `json:"group"`
	Note      string `json:"tasknote"`
}
